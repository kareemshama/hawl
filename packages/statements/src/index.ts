import type { StatementFormat } from "@hawl/core-types";
import { looksLikeOfx } from "./ofx.js";
import { looksLikeQif } from "./qif.js";

export { parseAmount, looksLikeAmount, looksLikeMoney } from "./amounts.js";
export { parseDate, looksLikeDate, inferDateOrder, defaultDateOrder } from "./dates.js";
export { parseCsvText, sniffDelimiter } from "./table.js";
export type { Table } from "./table.js";
export { detectMapping } from "./mapping.js";
export type { MappingGuess } from "./mapping.js";
export { tableToTransactions, hashString } from "./normalize.js";
export type { NormalizeResult, NormalizeOptions } from "./normalize.js";
export { parseOfx, looksLikeOfx } from "./ofx.js";
export type { OfxResult } from "./ofx.js";
export { parseQif, looksLikeQif } from "./qif.js";
export type { QifResult } from "./qif.js";
export { itemsToRows, rowsToTable, extractSummary, completeYears, explodeItem } from "./pdf.js";
export { dedupeIncoming, transactionKeys } from "./dedupe.js";
export type { PdfTextItem, PdfRow, PdfTableResult, PdfSummary } from "./pdf.js";
export { buildBalanceSeries, accountBalancePoints, balanceOn, lowestPoint, isCashAccount, addDays } from "./series.js";
export type { SeriesResult, AccountCoverage, BalancePoint } from "./series.js";

/** Decide the format from the file name, falling back to content sniffing. */
export function detectFormat(fileName: string, head: string): StatementFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || head.startsWith("%PDF")) return "pdf";
  if (ext === "ofx" || ext === "qfx" || looksLikeOfx(head)) return "ofx";
  if (ext === "qif" || looksLikeQif(head)) return "qif";
  if (ext === "csv" || ext === "txt" || ext === "tsv" || /[,;\t|]/.test(head.split(/\r?\n/)[0] ?? "")) return "csv";
  return null;
}
