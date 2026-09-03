/**
 * Turns a dropped file into a reviewable import, then commits it into the profile.
 */
import type { ColumnMapping, StatementFormat, StatementImport, Transaction } from "@hawl/core-types";
import {
  completeYears,
  defaultDateOrder,
  detectFormat,
  detectMapping,
  extractSummary,
  itemsToRows,
  parseCsvText,
  parseOfx,
  parseQif,
  rowsToTable,
  tableToTransactions,
  type MappingGuess,
  type PdfSummary,
  type Table,
} from "@hawl/statements";
import { extractPdf } from "./pdf";
import { newId, type Profile } from "./profile";

export interface Review {
  file: string;
  format: StatementFormat;
  /** Present for CSV and PDF, where the user may adjust the mapping. */
  table?: Table;
  pages?: number[];
  guess?: MappingGuess;
  mapping: ColumnMapping | null;
  summary?: PdfSummary;
  transactions: Transaction[];
  balanceVerified: boolean;
  warnings: string[];
  notes: string[];
  /** Hints from the file about which account it belongs to. */
  hint: { accountId?: string; accountType?: string; currency?: string; ledgerBalance?: number; ledgerDate?: string; periodStart?: string; periodEnd?: string };
  method?: "text" | "ocr" | "mixed";
}

const TEMP_ACCOUNT = "__pending__";

export async function analyzeFile(file: File, currency: string, onProgress?: (m: string) => void): Promise<Review> {
  const headBytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const head = new TextDecoder().decode(headBytes);
  const format = detectFormat(file.name, head);
  if (!format) throw new Error(`Cannot tell what kind of file ${file.name} is. Use PDF, CSV, OFX/QFX, or QIF.`);

  const dateOrder = defaultDateOrder(currency);
  const base = { file: file.name, format, mapping: null as ColumnMapping | null, transactions: [] as Transaction[], balanceVerified: false, warnings: [] as string[], notes: [] as string[], hint: {} as Review["hint"] };

  if (format === "ofx") {
    const r = parseOfx(await file.text(), { accountId: TEMP_ACCOUNT, file: file.name });
    return {
      ...base,
      transactions: r.transactions,
      balanceVerified: r.ledgerBalance !== undefined && r.transactions.length > 0,
      warnings: r.warnings,
      hint: {
        ...(r.accountId ? { accountId: r.accountId } : {}),
        ...(r.accountType ? { accountType: r.accountType } : {}),
        ...(r.currency ? { currency: r.currency } : {}),
        ...(r.ledgerBalance !== undefined ? { ledgerBalance: r.ledgerBalance } : {}),
        ...(r.ledgerDate ? { ledgerDate: r.ledgerDate } : {}),
        ...(r.periodStart ? { periodStart: r.periodStart } : {}),
        ...(r.periodEnd ? { periodEnd: r.periodEnd } : {}),
      },
    };
  }

  if (format === "qif") {
    const r = parseQif(await file.text(), { accountId: TEMP_ACCOUNT, file: file.name, dateOrder });
    return { ...base, transactions: r.transactions, warnings: [...r.warnings, "QIF files carry no running balance. Add a statement balance to anchor this account."], hint: r.accountType ? { accountType: r.accountType } : {} };
  }

  if (format === "csv") {
    const table = parseCsvText(await file.text());
    const guess = detectMapping(table, dateOrder);
    const review: Review = { ...base, table, guess, mapping: guess.mapping };
    return guess.mapping ? applyMapping(review, guess.mapping) : { ...review, warnings: guess.reasons };
  }

  // PDF
  const extraction = await extractPdf(file, onProgress);
  const summary = extractSummary(extraction.text);
  const { table, pages, notes } = rowsToTable(itemsToRows(extraction.items));
  completeYears(table, 0, summary);
  const guess = detectMapping(table, dateOrder);
  const review: Review = {
    ...base,
    table,
    pages,
    guess,
    mapping: guess.mapping,
    summary,
    notes: [...notes, ...summary.notes, extraction.method === "text" ? `Text layer read from ${extraction.pages} page${extraction.pages === 1 ? "" : "s"}.` : `OCR used (${extraction.method}). Check the numbers carefully.`],
    method: extraction.method,
    hint: {
      ...(summary.periodStart ? { periodStart: summary.periodStart } : {}),
      ...(summary.periodEnd ? { periodEnd: summary.periodEnd } : {}),
      ...(summary.closingBalance !== undefined ? { ledgerBalance: summary.closingBalance } : {}),
      ...(summary.periodEnd ? { ledgerDate: summary.periodEnd } : {}),
    },
  };
  if (!guess.mapping) {
    if (table.rows.length === 0 && (summary.openingBalance !== undefined || summary.closingBalance !== undefined)) {
      review.warnings = ["No transaction rows were recognized, but the statement summary was. The opening and closing balances will be used as single balance points."];
    } else {
      review.warnings = guess.reasons;
    }
    return review;
  }
  return applyMapping(review, guess.mapping);
}

/** Re-run normalization with a (possibly user-edited) mapping. */
export function applyMapping(review: Review, mapping: ColumnMapping): Review {
  if (!review.table) return review;
  const r = tableToTransactions(review.table, mapping, {
    accountId: TEMP_ACCOUNT,
    file: review.file,
    ...(review.pages ? { pages: review.pages } : {}),
    ...(review.summary?.openingBalance !== undefined ? { openingBalance: review.summary.openingBalance } : {}),
  });
  const warnings = [...r.warnings];
  if (review.summary?.closingBalance !== undefined && r.transactions.length > 0) {
    const last = r.transactions[r.transactions.length - 1]!;
    if (last.balanceAfter !== undefined && Math.abs(last.balanceAfter - review.summary.closingBalance) > 0.011) {
      warnings.push(`Last running balance ${last.balanceAfter} does not match the statement's closing balance ${review.summary.closingBalance}.`);
    }
  }
  return { ...review, mapping, transactions: r.transactions, balanceVerified: r.balanceVerified, warnings };
}

/**
 * Fingerprints used to skip transactions already imported from another file. The same
 * transaction can carry a different description in a PDF than in a CSV (continuation lines,
 * truncation), so when a running balance exists the date, amount, and balance identify it.
 * Without a balance the normalized description is part of the key.
 */
function fingerprints(t: Transaction): string[] {
  const keys = [`${t.accountId}|${t.date}|${t.amount}|d:${t.description.toLowerCase().replace(/\s+/g, " ").slice(0, 24)}`];
  if (t.balanceAfter !== undefined) keys.push(`${t.accountId}|${t.date}|${t.amount}|b:${t.balanceAfter}`);
  return keys;
}

/** Commit a reviewed import into the profile under the chosen account. Returns the new profile and the count added. */
export function commitImport(profile: Profile, review: Review, accountId: string, rememberMapping: boolean): { profile: Profile; added: number; skipped: number } {
  const existing = new Set(profile.transactions.flatMap(fingerprints));
  const incoming = review.transactions.map((t) => ({ ...t, id: t.id.replace(TEMP_ACCOUNT, accountId), accountId }));
  const fresh: Transaction[] = [];
  for (const t of incoming) {
    const keys = fingerprints(t);
    if (keys.some((k) => existing.has(k))) continue;
    keys.forEach((k) => existing.add(k));
    fresh.push(t);
  }
  const dates = incoming.map((t) => t.date).sort();

  const imp: StatementImport = {
    id: newId(),
    accountId,
    file: review.file,
    format: review.format,
    importedAt: new Date().toISOString(),
    transactionCount: fresh.length,
    balanceVerified: review.balanceVerified,
    notes: [...review.notes, ...review.warnings],
    ...(review.hint.periodStart ?? dates[0] ? { periodStart: review.hint.periodStart ?? dates[0]! } : {}),
    ...(review.hint.periodEnd ?? dates[dates.length - 1] ? { periodEnd: review.hint.periodEnd ?? dates[dates.length - 1]! } : {}),
    ...(review.summary?.openingBalance !== undefined ? { openingBalance: review.summary.openingBalance } : {}),
    ...(review.hint.ledgerBalance !== undefined ? { closingBalance: review.hint.ledgerBalance } : {}),
  };

  const accounts = profile.accounts.map((a) => (a.id === accountId && rememberMapping && review.mapping ? { ...a, mapping: review.mapping } : a));
  return {
    profile: { ...profile, accounts, transactions: [...profile.transactions, ...fresh], imports: [...profile.imports, imp] },
    added: fresh.length,
    skipped: incoming.length - fresh.length,
  };
}

export function removeImport(profile: Profile, importId: string): Profile {
  const imp = profile.imports.find((i) => i.id === importId);
  if (!imp) return profile;
  return {
    ...profile,
    imports: profile.imports.filter((i) => i.id !== importId),
    transactions: profile.transactions.filter((t) => !(t.accountId === imp.accountId && t.source.file === imp.file)),
  };
}

export function removeAccount(profile: Profile, accountId: string): Profile {
  return {
    ...profile,
    accounts: profile.accounts.filter((a) => a.id !== accountId),
    imports: profile.imports.filter((i) => i.accountId !== accountId),
    transactions: profile.transactions.filter((t) => t.accountId !== accountId),
  };
}
