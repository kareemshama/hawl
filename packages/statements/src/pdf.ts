/**
 * PDF statement logic that does not depend on pdf.js. The desktop app extracts positioned text
 * items with pdf.js and hands them here; this module rebuilds rows, finds the transaction table,
 * and pulls the summary block. Everything is testable with plain fixtures.
 */
import type { IsoDate } from "@hawl/core-types";
import { looksLikeMoney, parseAmount } from "./amounts.js";
import { looksLikeDate, parseDate } from "./dates.js";
import type { Table } from "./table.js";

export interface PdfTextItem {
  page: number;
  /** Left edge in PDF user units. */
  x: number;
  /** Baseline in PDF user units, larger is higher on the page. */
  y: number;
  width: number;
  str: string;
}

export interface PdfRow {
  page: number;
  y: number;
  items: PdfTextItem[];
  text: string;
}

const MONEY_TOKEN = /^[-−(]?[$£€]?[\d,]+\.\d{2}\)?(CR|DR)?-?$/i;
const DATE_TOKEN = /^(\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3}-\d{2,4})$/;

/**
 * pdf.js often merges a whole visual row into one text item ("01/05 PAYROLL 2,500.00 5,000.00").
 * Split such items into tokens with estimated x positions so columns can still be recovered.
 * Dates and money stay separate tokens; runs of other words are kept together as one token.
 */
export function explodeItems(items: PdfTextItem[]): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const it of items) {
    const s = it.str;
    const words = s.split(/\s+/).filter((w) => w !== "");
    if (words.length <= 1) {
      out.push(it);
      continue;
    }
    const charWidth = s.length > 0 ? it.width / s.length : 0;
    let cursor = 0;
    let run: { start: number; text: string } | null = null;
    const flush = () => {
      if (run) {
        out.push({ page: it.page, x: it.x + run.start * charWidth, y: it.y, width: run.text.length * charWidth, str: run.text });
        run = null;
      }
    };
    for (const w of words) {
      const start = s.indexOf(w, cursor);
      cursor = start + w.length;
      const special = MONEY_TOKEN.test(w) || DATE_TOKEN.test(w);
      if (special) {
        flush();
        out.push({ page: it.page, x: it.x + start * charWidth, y: it.y, width: w.length * charWidth, str: w });
      } else if (run) {
        run.text = `${run.text} ${w}`;
      } else {
        run = { start, text: w };
      }
    }
    flush();
  }
  return out;
}

/** Group text items into visual rows by page and baseline. Merged items are split first. */
export function itemsToRows(rawItems: PdfTextItem[], tolerance = 3): PdfRow[] {
  const items = explodeItems(rawItems);
  const rows: PdfRow[] = [];
  const sorted = [...items].filter((i) => i.str.trim() !== "").sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) {
      last.items.push(it);
    } else {
      rows.push({ page: it.page, y: it.y, items: [it], text: "" });
    }
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  }
  return rows;
}

const HEADER_HINT = /\b(?:date|description|details|withdrawals?|deposits?|debits?|credits?|amount|balance|money (?:in|out)|paid (?:in|out))\b/gi;
const IGNORE_ROW = /^(page \d+|continued|statement of account|beginning balance|ending balance|total|totals|daily balance|subtotal)/i;

export interface PdfTableResult {
  table: Table;
  /** Page for each row in `table.rows`. */
  pages: number[];
  /** Column labels inferred from the header row, aligned with table columns. */
  notes: string[];
}

/**
 * Find transaction rows: a row that starts with a date and ends with one to three amounts.
 * Rows between transactions without a date are description continuations.
 * Produces a table with columns [date, description, num1, num2, num3] where numbers are
 * assigned to header-labelled columns when a header row with x positions is found.
 */
export function rowsToTable(rows: PdfRow[]): PdfTableResult {
  const notes: string[] = [];

  // Header detection: a row with at least two header hints. Remember x centers of numeric labels.
  // A column header names at least two columns, carries no money values, and does not start with a date.
  // Summary lines like "Deposits and other credits 4,200.00" fail the money test.
  const header = rows.find((r) => (r.text.match(HEADER_HINT) ?? []).length >= 2 && !looksLikeDate(r.items[0]?.str ?? "") && !r.items.some((i) => looksLikeMoney(i.str)));
  type Col = { label: string; x: number };
  const numericCols: Col[] = [];
  if (header) {
    // Header words may sit inside one merged item; split every item into words with estimated x.
    for (const it of header.items) {
      const words = it.str.trim().split(/\s+/);
      const charWidth = it.str.length > 0 ? it.width / it.str.length : 0;
      let cursor = 0;
      for (const w of words) {
        const start = it.str.indexOf(w, cursor);
        cursor = start + w.length;
        const cx = it.x + (start + w.length / 2) * charWidth;
        if (/^(withdrawals?|debits?|payments?|out)$/i.test(w)) numericCols.push({ label: "debit", x: cx });
        else if (/^(deposits?|credits?|receipts?|in)$/i.test(w)) numericCols.push({ label: "credit", x: cx });
        else if (/^amount$/i.test(w)) numericCols.push({ label: "amount", x: cx });
        else if (/^balance$/i.test(w)) numericCols.push({ label: "balance", x: cx });
      }
    }
    if (numericCols.length > 0) notes.push(`Header found on page ${header.page}: ${numericCols.map((c) => c.label).join(", ")}.`);
  }

  const labels = numericCols.length > 0 ? numericCols.map((c) => c.label) : null;
  const out: string[][] = [];
  const pages: number[] = [];
  const lineNumbers: number[] = [];
  let lastTxn: string[] | null = null;
  let maxNums = 0;

  rows.forEach((r, idx) => {
    if (IGNORE_ROW.test(r.text)) {
      lastTxn = null;
      return;
    }
    const strs = r.items.map((i) => i.str.trim());
    const first = strs[0] ?? "";
    // Some banks split "01/05" and "2026" or put a second date (posting date) next.
    let dateStr = first;
    let start = 1;
    if (!looksLikeDate(first) && strs[1] && looksLikeDate(`${first} ${strs[1]}`)) {
      dateStr = `${first} ${strs[1]}`;
      start = 2;
    }
    const isDated = looksLikeDate(dateStr) || /^\d{1,2}\/\d{1,2}$/.test(dateStr);
    if (!isDated) {
      // Continuation of the previous description.
      if (lastTxn && strs.length > 0 && !strs.some(looksLikeMoney) && r.text.length < 120) {
        lastTxn[1] = `${lastTxn[1]} ${r.text}`.trim();
      }
      return;
    }
    if (looksLikeDate(strs[start] ?? "")) start++; // skip a second date column such as "posted"

    // Trailing amounts.
    const nums: PdfTextItem[] = [];
    let end = r.items.length;
    while (end > start && nums.length < 3 && looksLikeMoney(r.items[end - 1]!.str)) {
      nums.unshift(r.items[end - 1]!);
      end--;
    }
    if (nums.length === 0) {
      lastTxn = null;
      return;
    }
    const description = strs.slice(start, end).join(" ").replace(/\s+/g, " ").trim();

    let cells: string[];
    if (labels) {
      cells = labels.map(() => "");
      for (const n of nums) {
        const center = n.x + n.width / 2;
        let best = 0;
        let bestD = Infinity;
        numericCols.forEach((c, i) => {
          const d = Math.abs(c.x - center);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        cells[best] = n.str.trim();
      }
    } else {
      cells = nums.map((n) => n.str.trim());
      maxNums = Math.max(maxNums, cells.length);
    }
    lastTxn = [dateStr, description, ...cells];
    out.push(lastTxn);
    pages.push(r.page);
    lineNumbers.push(idx + 1);
  });

  let headers: string[] | null = null;
  if (labels) {
    headers = ["Date", "Description", ...labels.map((l) => l.charAt(0).toUpperCase() + l.slice(1))];
  } else if (out.length > 0) {
    // Right-align numbers so the balance is always the last column.
    for (const r of out) {
      const nums = r.slice(2);
      while (nums.length < maxNums) nums.unshift("");
      r.splice(2, r.length - 2, ...nums);
    }
    headers = maxNums >= 3 ? ["Date", "Description", "Debit", "Credit", "Balance"] : maxNums === 2 ? ["Date", "Description", "Amount", "Balance"] : ["Date", "Description", "Amount"];
    notes.push("No header row found; numeric columns inferred from position.");
  }

  // Dates like 01/05 with no year: infer the year from the statement period if possible later.
  return { table: { headers, rows: out, lineNumbers }, pages, notes };
}

export interface PdfSummary {
  openingBalance?: number;
  closingBalance?: number;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  notes: string[];
}

/** Pull opening and closing balances and the statement period from free text. */
export function extractSummary(text: string): PdfSummary {
  const t = text.replace(/\s+/g, " ");
  const notes: string[] = [];
  const money = "([-−(]?[$£€]?\\s?[\\d,]+\\.\\d{2}\\)?(?:\\s?(?:CR|DR))?)";
  const open = new RegExp(`(?:beginning|opening|previous|starting|brought forward|balance forward|opening ledger|start(?:ing)? balance|balance at start)[^\\d$£€(-]{0,40}${money}`, "i").exec(t);
  const close = new RegExp(`(?:ending|closing|new|final|carried forward|end(?:ing)? balance|balance at end|closing ledger)[^\\d$£€(-]{0,40}${money}`, "i").exec(t);
  const datePat = "(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{1,2} [A-Za-z]{3,9},? \\d{4}|[A-Za-z]{3,9} \\d{1,2},? \\d{4}|\\d{4}-\\d{2}-\\d{2})";
  const period = new RegExp(`(?:statement period|period|from|for the period)\\D{0,20}${datePat}\\s*(?:to|through|-|–|—)\\s*${datePat}`, "i").exec(t) ?? new RegExp(`${datePat}\\s*(?:to|through|-|–|—)\\s*${datePat}`, "i").exec(t);

  const out: PdfSummary = { notes };
  const o = open ? parseAmount(open[1]!) : null;
  const c = close ? parseAmount(close[1]!) : null;
  if (o !== null) out.openingBalance = o;
  if (c !== null) out.closingBalance = c;
  if (period) {
    const s = parseDate(period[1]!, "mdy") ?? parseDate(period[1]!, "dmy");
    const e = parseDate(period[2]!, "mdy") ?? parseDate(period[2]!, "dmy");
    if (s) out.periodStart = s;
    if (e) out.periodEnd = e;
  }
  if (o === null && c === null) notes.push("No opening or closing balance found in the text.");
  if (!period) notes.push("No statement period found in the text.");
  return out;
}

/** Fill in a year for MM/DD dates using the statement period. */
export function completeYears(table: Table, dateCol: number, period: { periodStart?: IsoDate; periodEnd?: IsoDate }): void {
  const endYear = period.periodEnd ? Number(period.periodEnd.slice(0, 4)) : period.periodStart ? Number(period.periodStart.slice(0, 4)) : new Date().getFullYear();
  const endMonth = period.periodEnd ? Number(period.periodEnd.slice(5, 7)) : 12;
  for (const r of table.rows) {
    const v = r[dateCol] ?? "";
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(v);
    if (!m) continue;
    const month = Number(m[1]);
    // A December date on a statement ending in January belongs to the previous year.
    const year = month > endMonth ? endYear - 1 : endYear;
    r[dateCol] = `${m[1]}/${m[2]}/${year}`;
  }
}
