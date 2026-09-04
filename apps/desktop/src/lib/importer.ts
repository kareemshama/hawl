/**
 * Turns a dropped file into a reviewable import, then commits it into the profile.
 */
import type { ColumnMapping, StatementFormat, StatementImport, Transaction } from "@hawl/core-types";
import {
  completeYears,
  dedupeIncoming,
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
import { aiExtractPage } from "./commands";
import { extractPdf, type PdfExtraction } from "./pdf";
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
  method?: "text" | "ocr" | "mixed" | "ai";
  /** The heuristics found nothing and the local AI was not available. */
  aiSuggested?: boolean;
  /** Kept so a PDF can be re-read with the AI from the review card. */
  sourceFile?: File;
}

export interface AnalyzeOptions {
  /** "auto": use the AI only when the heuristics fail. "force": always use it for PDFs. "off": never. */
  ai?: "auto" | "force" | "off";
  /** Whether the local AI is set up. Without it "auto" only flags the review. */
  aiReady?: boolean;
}

const TEMP_ACCOUNT = "__pending__";

export async function analyzeFile(file: File, currency: string, onProgress?: (m: string) => void, opts: AnalyzeOptions = {}): Promise<Review> {
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
  const aiMode = opts.ai ?? "auto";
  if (aiMode === "force" && opts.aiReady) {
    return aiReview({ ...base, sourceFile: file }, extraction, summary, currency, onProgress);
  }
  const { table, pages, notes } = rowsToTable(itemsToRows(extraction.items));
  completeYears(table, 0, summary);
  const guess = detectMapping(table, dateOrder);
  let review: Review = {
    ...base,
    sourceFile: file,
    table,
    pages,
    guess,
    mapping: guess.mapping,
    summary,
    notes: [...notes, ...summary.notes, extraction.method === "text" ? `Text layer read from ${extraction.pages} page${extraction.pages === 1 ? "" : "s"}.` : `OCR used (${extraction.method}). Check the numbers carefully.`],
    method: extraction.method,
    hint: summaryHint(summary),
  };
  if (guess.mapping) review = applyMapping(review, guess.mapping);

  const failed = !guess.mapping || review.transactions.length === 0;
  if (failed && aiMode === "auto" && opts.aiReady) {
    return aiReview({ ...base, sourceFile: file }, extraction, summary, currency, onProgress);
  }
  if (!guess.mapping) {
    if (table.rows.length === 0 && (summary.openingBalance !== undefined || summary.closingBalance !== undefined)) {
      review.warnings = ["No transaction rows were recognized, but the statement summary was. The opening and closing balances will be used as single balance points."];
    } else {
      review.warnings = guess.reasons;
    }
  }
  if (failed && aiMode !== "off") {
    review.aiSuggested = true;
    if (!opts.aiReady) review.warnings = [...review.warnings, "The local AI can read statements laid out like this one. Set it up in Settings, then drop the file again."];
  }
  return review;
}

function summaryHint(summary: PdfSummary): Review["hint"] {
  return {
    ...(summary.periodStart ? { periodStart: summary.periodStart } : {}),
    ...(summary.periodEnd ? { periodEnd: summary.periodEnd } : {}),
    ...(summary.closingBalance !== undefined ? { ledgerBalance: summary.closingBalance } : {}),
    ...(summary.periodEnd ? { ledgerDate: summary.periodEnd } : {}),
  };
}

const AI_HEADERS = ["Date", "Description", "Amount", "Balance"];

/**
 * Read a PDF page by page with the local AI. The rows come back as a fixed four-column table so
 * the rest of the pipeline (mapping, running-balance check, dedupe, review) is the same as for CSV.
 */
async function aiReview(base: Omit<Review, "table" | "pages" | "guess" | "summary">, extraction: PdfExtraction, heuristic: PdfSummary, currency: string, onProgress?: (m: string) => void): Promise<Review> {
  const rows: string[][] = [];
  const pages: number[] = [];
  const summary: PdfSummary = { ...heuristic, notes: [...heuristic.notes] };
  let periodStart = summary.periodStart ?? null;
  let periodEnd = summary.periodEnd ?? null;
  let lastSection: string | null = null;
  const total = extraction.pageTexts.length;
  for (let p = 0; p < total; p++) {
    const text = extraction.pageTexts[p] ?? "";
    if (text.trim().length < 20) continue;
    onProgress?.(`AI reading page ${p + 1} of ${total}`);
    const page = await aiExtractPage(text, periodStart, periodEnd, lastSection, currency);
    if (!periodStart && page.periodStart) periodStart = page.periodStart;
    if (!periodEnd && page.periodEnd) periodEnd = page.periodEnd;
    if (summary.openingBalance === undefined && page.openingBalance !== null && page.openingBalance !== undefined) summary.openingBalance = page.openingBalance;
    if (summary.closingBalance === undefined && page.closingBalance !== null && page.closingBalance !== undefined) summary.closingBalance = page.closingBalance;
    for (const r of page.rows) {
      if (!r || typeof r.date !== "string" || typeof r.amount !== "number" || !Number.isFinite(r.amount)) continue;
      const amount = signFromSection(r.amount, r.section ?? "");
      rows.push([r.date.trim(), (r.description ?? "").trim(), String(amount), r.balance === null || r.balance === undefined ? "" : String(r.balance)]);
      pages.push(p + 1);
      if (r.section && r.section.trim() !== "") lastSection = r.section.trim();
    }
  }
  if (periodStart) summary.periodStart = periodStart;
  if (periodEnd) summary.periodEnd = periodEnd;
  if (summary.openingBalance !== undefined || summary.closingBalance !== undefined) {
    summary.notes = summary.notes.filter((n) => !/no opening or closing balance/i.test(n));
  }
  const table: Table = { headers: AI_HEADERS, rows, lineNumbers: rows.map((_, i) => i + 1) };
  const withBalance: ColumnMapping = { date: 0, description: 1, amount: 2, balance: 3, dateOrder: "ymd", hasHeader: true };
  const withoutBalance: ColumnMapping = { date: 0, description: 1, amount: 2, dateOrder: "ymd", hasHeader: true };
  const notes = [...base.notes, ...summary.notes, `Rows read by the local AI from ${total} page${total === 1 ? "" : "s"}. Check the numbers against the statement.`];
  const make = (mapping: ColumnMapping): Review => ({
    ...base,
    table,
    pages,
    guess: { mapping, confidence: rows.length > 0 ? "medium" : "low", reasons: [] },
    mapping,
    summary,
    method: "ai",
    notes,
    hint: summaryHint(summary),
  });
  if (rows.length === 0) {
    return { ...make(withoutBalance), warnings: ["The AI found no transactions in this file."] };
  }
  // Only trust running balances the model reports if they chain from row to row; a model can
  // invent balances for statements that never print them, and those must not enter the history.
  if (rows.some((r) => r[3] !== "")) {
    const trial = applyMapping(make(withBalance), withBalance);
    if (trial.balanceVerified) return trial;
    for (const r of rows) r[3] = "";
  }
  return applyMapping(make(withoutBalance), withoutBalance);
}

const MONEY_IN = /deposit|addition|credit|paid in|money in|interest (earned|paid)|refund|income|receipt/i;
const MONEY_OUT = /withdraw|subtraction|debit|check|cheque|fee|charge|purchase|payment|paid out|money out|spending|transfer out/i;

/**
 * The heading a row sits under decides its sign on statements that print unsigned amounts in
 * sections. The model's own sign is kept only when the heading says nothing.
 */
export function signFromSection(amount: number, section: string): number {
  const s = section.trim();
  if (s === "") return amount;
  const magnitude = Math.abs(amount);
  if (MONEY_IN.test(s) && !MONEY_OUT.test(s)) return magnitude;
  if (MONEY_OUT.test(s) && !MONEY_IN.test(s)) return -magnitude;
  return amount;
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
  let balanceVerified = r.balanceVerified;
  if (review.summary?.closingBalance !== undefined && r.transactions.length > 0) {
    const last = r.transactions[r.transactions.length - 1]!;
    if (last.balanceAfter !== undefined && Math.abs(last.balanceAfter - review.summary.closingBalance) > 0.011) {
      warnings.push(`Last running balance ${last.balanceAfter} does not match the statement's closing balance ${review.summary.closingBalance}.`);
    }
  }
  // No running-balance column: the statement's own totals can still vouch for the rows.
  if (mapping.balance === undefined && review.summary?.openingBalance !== undefined && review.summary?.closingBalance !== undefined && r.transactions.length > 0) {
    const sum = r.transactions.reduce((acc, t) => acc + t.amount, 0);
    const expected = review.summary.closingBalance - review.summary.openingBalance;
    if (Math.abs(sum - expected) <= 0.011) {
      balanceVerified = true;
    } else {
      warnings.push(`The rows add up to ${sum.toFixed(2)}, but the statement moves from ${review.summary.openingBalance} to ${review.summary.closingBalance} (a change of ${expected.toFixed(2)}). Some rows may be missing or have the wrong sign.`);
    }
  }
  return { ...review, mapping, transactions: r.transactions, balanceVerified, warnings };
}

/** Commit a reviewed import into the profile under the chosen account. Returns the new profile and the count added. */
export function commitImport(profile: Profile, review: Review, accountId: string, rememberMapping: boolean): { profile: Profile; added: number; skipped: number } {
  const incoming = review.transactions.map((t) => ({ ...t, id: t.id.replace(TEMP_ACCOUNT, accountId), accountId }));
  const { fresh } = dedupeIncoming(profile.transactions.filter((t) => t.accountId === accountId), incoming);
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
