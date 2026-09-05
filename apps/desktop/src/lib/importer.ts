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
  // Rows were found but the statement's own totals do not vouch for them: the AI reads it instead.
  const weak = !failed && summary.openingBalance !== undefined && summary.closingBalance !== undefined && !review.balanceVerified;
  if ((failed || weak) && aiMode === "auto" && opts.aiReady) {
    return aiReview({ ...base, sourceFile: file }, extraction, summary, currency, onProgress);
  }
  if (!guess.mapping) {
    if (table.rows.length === 0 && (summary.openingBalance !== undefined || summary.closingBalance !== undefined)) {
      review.warnings = ["No transaction rows were recognized, but the statement summary was. The opening and closing balances will be used as single balance points."];
    } else {
      review.warnings = guess.reasons;
    }
  }
  if ((failed || weak) && aiMode !== "off") {
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
  const cutPages: number[] = [];
  const total = extraction.pageTexts.length;
  for (let p = 0; p < total; p++) {
    const text = extraction.pageTexts[p] ?? "";
    if (text.trim().length < 20) continue;
    // A dense page is sent in pieces so every answer stays well inside the model's output limit,
    // and a piece is split again when the model returns fewer rows than the text plainly holds.
    const chunks = chunkPageText(text);
    let part = 0;
    const readChunk = async (piece: string, depth: number): Promise<void> => {
      part++;
      onProgress?.(`AI reading page ${p + 1} of ${total}${chunks.length > 1 || part > 1 ? ` (part ${part})` : ""}`);
      const page = await aiExtractPage(piece, periodStart, periodEnd, lastSection, currency);
      const expected = countCandidateRows(piece);
      if (page.rows.length < expected && depth < 4) {
        const halves = splitInTwo(piece);
        if (halves) {
          await readChunk(halves[0], depth + 1);
          await readChunk(halves[1], depth + 1);
          return;
        }
      }
      if (page.truncated) cutPages.push(p + 1);
      if (!periodStart && page.periodStart) periodStart = page.periodStart;
      if (!periodEnd && page.periodEnd) periodEnd = page.periodEnd;
      if (summary.openingBalance === undefined && page.openingBalance !== null && page.openingBalance !== undefined) summary.openingBalance = page.openingBalance;
      if (summary.closingBalance === undefined && page.closingBalance !== null && page.closingBalance !== undefined) summary.closingBalance = page.closingBalance;
      for (const r of page.rows) {
        if (!r || typeof r.date !== "string" || typeof r.amount !== "number" || !Number.isFinite(r.amount)) continue;
        // A zero row is a summary line ("Service fees -0.00") the model mistook for a transaction.
        if (Math.round(r.amount * 100) === 0) continue;
        const amount = signFromSection(r.amount, r.section ?? "");
        rows.push([r.date.trim(), (r.description ?? "").trim(), String(amount), r.balance === null || r.balance === undefined ? "" : String(r.balance)]);
        pages.push(p + 1);
        if (r.section && r.section.trim() !== "") lastSection = r.section.trim();
      }
      // A heading printed after the last row of this piece governs the next piece, whatever the
      // model returned (it may have returned nothing for a piece that ends with a heading).
      const trailing = trailingHeading(piece);
      if (trailing) lastSection = trailing;
    };
    for (const piece of chunks) await readChunk(piece, 0);
  }
  if (periodStart && periodEnd) {
    const fixed = fitDatesToPeriod(rows, periodStart, periodEnd);
    if (fixed.outside > 0) summary.notes.push(`${fixed.outside} row${fixed.outside === 1 ? "" : "s"} carry a date outside the statement period ${periodStart} to ${periodEnd}. Check them.`);
  }
  if (cutPages.length > 0) {
    summary.notes.push(`The AI's answer was cut short on page${cutPages.length === 1 ? "" : "s"} ${[...new Set(cutPages)].join(", ")}; some rows there may be missing.`);
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
  if (rows.length > 0 && rows.every((r) => r[3] !== "")) {
    const trial = applyMapping(make(withBalance), withBalance);
    if (trial.balanceVerified) return trial;
  }
  for (const r of rows) r[3] = "";
  return applyMapping(make(withoutBalance), withoutBalance);
}

/** Longest piece of page text sent to the model in one request. */
const AI_CHUNK_CHARS = 2000;
/** Below this a piece is not split further, whatever the model returns. */
const AI_MIN_CHUNK_CHARS = 350;

/** Start of a transaction row: whitespace, then a month/day date. Never matches an amount like 12.50. */
const DATE_TOKEN = /\s(?=(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])(?:[/-]\d{2,4})?\s)/g;

/**
 * How many transaction rows the text plainly contains: date tokens that are followed by some
 * description and end in an amount. Date-only tables (daily balances) count too, which only makes
 * the check stricter.
 */
export function countCandidateRows(text: string): number {
  const m = ` ${text}`.match(/\s(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])(?:[/-]\d{2,4})?\s+(?=\S)/g);
  return m ? m.length : 0;
}

/** Split a piece near its middle, just before a date token; null when it is already small. */
export function splitInTwo(text: string): [string, string] | null {
  if (text.length < AI_MIN_CHUNK_CHARS * 2) return null;
  const mid = text.length / 2;
  let best = -1;
  let m: RegExpExecArray | null;
  const re = new RegExp(DATE_TOKEN.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index;
  }
  if (best < AI_MIN_CHUNK_CHARS || text.length - best < AI_MIN_CHUNK_CHARS) return null;
  return [text.slice(0, best).trim(), text.slice(best).trim()];
}

/**
 * Split a page's text into pieces of at most AI_CHUNK_CHARS, cutting just before a date so a
 * transaction is never split across two requests.
 */
export function chunkPageText(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > AI_CHUNK_CHARS) {
    const window = rest.slice(0, AI_CHUNK_CHARS);
    const dateStart = new RegExp(DATE_TOKEN.source, "g");
    let cut = -1;
    let m: RegExpExecArray | null;
    while ((m = dateStart.exec(window)) !== null) {
      if (m.index > AI_CHUNK_CHARS / 3) cut = m.index;
    }
    if (cut < 0) {
      const space = window.lastIndexOf(" ");
      cut = space > AI_CHUNK_CHARS / 2 ? space : AI_CHUNK_CHARS;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

const MONEY_IN = /\b(?:deposits?|additions?|credits?|paid in|money in|interest (?:earned|paid)|refunds?|income|receipts?)\b/i;
const MONEY_OUT = /\b(?:withdrawals?|subtractions?|debits?|checks?|cheques?|fees?|charges?|purchases?|payments?|paid out|money out|spending|transfers? out)\b/i;

/** Section headings statements print between groups of rows. */
const HEADING = /\b(deposits and other (?:additions|credits)|withdrawals and other (?:subtractions|debits)|checks(?: paid)?|service fees|fees|payments and (?:other )?credits|purchases(?: and adjustments)?|interest charged|deposits|withdrawals)\b/gi;

/** The heading printed after the last dated row of a piece of text, if any. */
export function trailingHeading(text: string): string | null {
  let lastDate = -1;
  const dates = new RegExp(DATE_TOKEN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = dates.exec(text)) !== null) lastDate = m.index;
  let heading: { index: number; text: string } | null = null;
  const re = new RegExp(HEADING.source, "gi");
  while ((m = re.exec(text)) !== null) heading = { index: m.index, text: m[1]! };
  return heading && heading.index > lastDate ? heading.text : null;
}

/**
 * Dates the model returned that fall outside the statement period usually have the wrong year
 * (a January statement reading December rows, say). Move them by a year when that lands inside
 * the period; count the rest.
 */
export function fitDatesToPeriod(rows: string[][], start: string, end: string): { outside: number } {
  let outside = 0;
  for (const r of rows) {
    const d = r[0] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      outside++;
      continue;
    }
    if (d >= start && d <= end) continue;
    const year = Number(d.slice(0, 4));
    const fixed = [year - 1, year + 1].map((y) => `${y}${d.slice(4)}`).find((c) => c >= start && c <= end);
    if (fixed) r[0] = fixed;
    else outside++;
  }
  return { outside };
}

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
  const cents = (v: number) => Math.round(v * 100);
  if (review.summary?.closingBalance !== undefined && r.transactions.length > 0) {
    const last = r.transactions[r.transactions.length - 1]!;
    if (last.balanceAfter !== undefined && cents(last.balanceAfter) !== cents(review.summary.closingBalance)) {
      balanceVerified = false;
      warnings.push(`Last running balance ${last.balanceAfter} does not match the statement's closing balance ${review.summary.closingBalance}.`);
    }
  }
  // No running-balance column: the statement's own totals can still vouch for the rows.
  if (mapping.balance === undefined && review.summary?.openingBalance !== undefined && review.summary?.closingBalance !== undefined && r.transactions.length > 0) {
    const sum = r.transactions.reduce((acc, t) => acc + cents(t.amount), 0);
    const expected = cents(review.summary.closingBalance) - cents(review.summary.openingBalance);
    if (sum === expected) {
      balanceVerified = true;
    } else {
      warnings.push(`The rows add up to ${(sum / 100).toFixed(2)}, but the statement moves from ${review.summary.openingBalance} to ${review.summary.closingBalance} (a change of ${(expected / 100).toFixed(2)}). Some rows may be missing or have the wrong sign.`);
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
