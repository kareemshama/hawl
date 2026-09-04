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
  /** Set on tokens produced by splitting a merged item; their x is estimated, their right edge is not. */
  estimated?: boolean;
}

export interface PdfRow {
  page: number;
  y: number;
  items: PdfTextItem[];
  text: string;
  /** True when this row came from one or two merged items that had to be split into tokens. */
  merged: boolean;
}

/** Partial dates such as 01/05 (no year). Full dates are recognized by looksLikeDate. Never matches 12.50. */
const DATE_TOKEN = /^\d{1,2}\/\d{1,2}$/;
const HEADER_HINT = /\b(?:date|description|details|withdrawals?|deposits?|debits?|credits?|amount|balance|money (?:in|out)|paid (?:in|out))\b/gi;
const IGNORE_ROW = /^(page \d+|continued|statement of account|beginning balance|ending balance|total|totals|daily balance|subtotal)/i;

function isDateWord(w: string): boolean {
  return DATE_TOKEN.test(w) || looksLikeDate(w);
}

/**
 * Split one text item into tokens. Dates and money become their own tokens; runs of other words
 * stay together. x is estimated from character offsets in the ORIGINAL string (so multi-space
 * padding is respected); the last token's right edge equals the item's right edge exactly.
 */
export function explodeItem(it: PdfTextItem): PdfTextItem[] {
  const s = it.str;
  const charWidth = s.length > 0 ? it.width / s.length : 0;
  const tokens: PdfTextItem[] = [];
  const re = /\S+/g;
  let run: { start: number; end: number } | null = null;
  const push = (start: number, end: number) => {
    tokens.push({ page: it.page, x: it.x + start * charWidth, y: it.y, width: (end - start) * charWidth, str: s.slice(start, end).replace(/\s+/g, " "), estimated: true });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const w = m[0];
    const start = m.index;
    const end = start + w.length;
    if (looksLikeMoney(w) || isDateWord(w)) {
      if (run) {
        push(run.start, run.end);
        run = null;
      }
      push(start, end);
    } else if (run) {
      run.end = end;
    } else {
      run = { start, end };
    }
  }
  if (run) push(run.start, run.end);
  // The final token's right edge is known exactly.
  const last = tokens[tokens.length - 1];
  if (last) {
    const right = it.x + it.width;
    last.x = right - last.width;
    last.estimated = tokens.length > 1 ? true : it.estimated ?? false;
  }
  return tokens;
}

/** Does this row look like pdf.js merged a whole transaction line into one or two items? */
function isMergedTransactionRow(items: PdfTextItem[]): boolean {
  if (items.length > 2) return false;
  const text = items.map((i) => i.str.trim()).join(" ");
  const words = text.split(/\s+/);
  if (words.length < 3) return false;
  const first = words[0]!;
  const startsWithDate = isDateWord(first) || (words[1] !== undefined && looksLikeDate(`${first} ${words[1]}`));
  const endsWithMoney = looksLikeMoney(words[words.length - 1]!);
  return startsWithDate && endsWithMoney;
}

function isMergedHeaderRow(items: PdfTextItem[]): boolean {
  if (items.length > 2) return false;
  const text = items.map((i) => i.str).join(" ");
  return (text.match(HEADER_HINT) ?? []).length >= 2 && !items.some((i) => looksLikeMoney(i.str.trim()));
}

/**
 * Group text items into visual rows by page and baseline. Rows that pdf.js merged into one or two
 * items (a date at the start, money at the end) are split into tokens; rows that already have
 * separate items are left untouched so descriptions containing amounts stay intact.
 */
export function itemsToRows(rawItems: PdfTextItem[], tolerance = 3): PdfRow[] {
  const rows: PdfRow[] = [];
  const sorted = [...rawItems].filter((i) => i.str.trim() !== "").sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) {
      last.items.push(it);
    } else {
      rows.push({ page: it.page, y: it.y, items: [it], text: "", merged: false });
    }
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    if (isMergedTransactionRow(r.items) || isMergedHeaderRow(r.items)) {
      r.items = r.items.flatMap(explodeItem).sort((a, b) => a.x - b.x);
      r.merged = true;
    }
    r.text = r.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  }
  return rows;
}

export interface PdfTableResult {
  table: Table;
  /** Page for each row in `table.rows`. */
  pages: number[];
  notes: string[];
}

type ColLabel = "debit" | "credit" | "amount" | "balance";
interface Col {
  label: ColLabel;
  /** Right edge of the header word, the alignment edge for numeric columns. */
  right: number;
}

/**
 * Header words to column labels. Punctuation and plurals are tolerated; "Withdrawal Amount" is one
 * column. Every word's right edge is estimated from its character offset inside its item, which
 * works for separate items, raw multi-word items, and runs produced by explodeItem alike.
 */
function headerColumns(items: PdfTextItem[]): Col[] {
  const cols: Col[] = [];
  let prevLabel: ColLabel | null = null;
  for (const it of items) {
    const s = it.str;
    const charWidth = s.length > 0 ? it.width / s.length : 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const word = m[0];
      const right = it.x + (m.index + word.length) * charWidth;
      const w = word.replace(/[^a-z]/gi, "").toLowerCase();
      if (w === "") continue;
      let label: ColLabel | null = null;
      if (/^(withdrawals?|debits?|payments?|out)$/.test(w)) label = "debit";
      else if (/^(deposits?|credits?|receipts?|in)$/.test(w)) label = "credit";
      else if (/^amounts?$/.test(w)) label = prevLabel === "debit" || prevLabel === "credit" ? null : "amount";
      else if (/^balances?$/.test(w)) label = "balance";

      if (label && !cols.some((c) => c.label === label)) {
        cols.push({ label, right });
        prevLabel = label;
      } else if (label === null && /^amounts?$/.test(w) && (prevLabel === "debit" || prevLabel === "credit")) {
        // "Withdrawal Amount": the column's alignment edge is the end of the second word.
        const prev = cols[cols.length - 1];
        if (prev) prev.right = right;
      } else {
        prevLabel = label;
      }
    }
  }
  return cols;
}

/**
 * Find transaction rows: a row that starts with a date and ends with one to three amounts.
 * Rows between transactions without a date are description continuations.
 * Numbers are assigned to header columns by right edge (numeric columns are right-aligned).
 * For merged rows only the last number's edge is exact, so the last number takes the rightmost
 * matching column and any other number is placed in the first remaining column; the running
 * balance check later fixes its sign.
 */
export function rowsToTable(rows: PdfRow[]): PdfTableResult {
  const notes: string[] = [];
  const header = rows.find((r) => (r.text.match(HEADER_HINT) ?? []).length >= 2 && !isDateWord(r.items[0]?.str.trim() ?? "") && !r.items.some((i) => looksLikeMoney(i.str.trim())));
  const cols = header ? headerColumns(header.items) : [];
  const labels = cols.length > 0 ? cols.map((c) => c.label) : null;
  if (labels) notes.push(`Header found on page ${header!.page}: ${labels.join(", ")}.`);

  const out: string[][] = [];
  const pages: number[] = [];
  const lineNumbers: number[] = [];
  let lastTxn: string[] | null = null;
  let maxNums = 0;
  let mergedAmbiguous = 0;

  const appendContinuation = (r: PdfRow, text: string) => {
    if (lastTxn && text && r.text.length < 120) lastTxn[1] = `${lastTxn[1]} ${text}`.replace(/\s+/g, " ").trim();
  };

  rows.forEach((r, idx) => {
    if (IGNORE_ROW.test(r.text)) {
      lastTxn = null;
      return;
    }
    const strs = r.items.map((i) => i.str.trim());
    const first = strs[0] ?? "";
    let dateStr = first;
    let start = 1;
    if (!looksLikeDate(first) && strs[1] && looksLikeDate(`${first} ${strs[1]}`)) {
      dateStr = `${first} ${strs[1]}`;
      start = 2;
    }
    const isDated = isDateWord(dateStr);
    if (!isDated) {
      // Continuation of the previous description. A row with its own separate amount items is not one.
      if (!r.merged && !r.items.some((i) => looksLikeMoney(i.str.trim()))) appendContinuation(r, r.text);
      else if (r.merged && !strs.slice(0).some((s, i) => i === strs.length - 1 && looksLikeMoney(s))) appendContinuation(r, r.text);
      return;
    }
    if (looksLikeDate(strs[start] ?? "")) start++; // second date column such as "posted"

    const nums: PdfTextItem[] = [];
    let end = r.items.length;
    while (end > start && nums.length < 3 && looksLikeMoney(r.items[end - 1]!.str.trim())) {
      nums.unshift(r.items[end - 1]!);
      end--;
    }
    if (nums.length === 0) {
      // A dated line with no amounts is a detail line ("01/02 STARBUCKS SEATTLE"), not a transaction.
      appendContinuation(r, r.text);
      return;
    }
    const description = strs.slice(start, end).join(" ").replace(/\s+/g, " ").trim();

    let cells: string[];
    if (labels) {
      cells = labels.map(() => "");
      const nearest = (right: number) => {
        let best = 0;
        let bestD = Infinity;
        cols.forEach((c, i) => {
          const d = Math.abs(c.right - right);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        return best;
      };
      if (r.merged) {
        const lastNum = nums[nums.length - 1]!;
        const lastCol = nearest(lastNum.x + lastNum.width);
        cells[lastCol] = lastNum.str.trim();
        const remaining = nums.slice(0, -1);
        const free = labels.map((_, i) => i).filter((i) => i !== lastCol);
        remaining.forEach((n, k) => {
          const target = free[k];
          if (target !== undefined) cells[target] = n.str.trim();
        });
        if (labels.includes("debit") && labels.includes("credit")) mergedAmbiguous++;
      } else {
        for (const n of nums) cells[nearest(n.x + n.width)] = n.str.trim();
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
    for (const r of out) {
      const nums = r.slice(2);
      while (nums.length < maxNums) nums.unshift("");
      r.splice(2, r.length - 2, ...nums);
    }
    headers = maxNums >= 3 ? ["Date", "Description", "Debit", "Credit", "Balance"] : maxNums === 2 ? ["Date", "Description", "Amount", "Balance"] : ["Date", "Description", "Amount"];
    notes.push("No header row found; numeric columns inferred from position.");
  }
  if (mergedAmbiguous > 0) {
    notes.push(
      labels?.includes("balance")
        ? `${mergedAmbiguous} row${mergedAmbiguous === 1 ? "" : "s"} had merged text; the direction of each amount was taken from the running balance.`
        : `${mergedAmbiguous} row${mergedAmbiguous === 1 ? "" : "s"} had merged text and no running balance, so money in versus money out could not be determined. Check the signs.`,
    );
  }

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
  // Between the label and the amount there may be a date ("Beginning balance on March 1, 2026 $4,210.55"),
  // so digits are allowed as long as they are part of a date, not a bare amount.
  const gap = "(?:[^\\d$£€(-]|\\d{1,2}(?:,|\\s|st|nd|rd|th)|\\d{4}\\b){0,40}?";
  const open = new RegExp(`(?:beginning|opening|previous|starting|brought forward|balance forward|opening ledger|start(?:ing)? balance|balance at start)${gap}${money}`, "i").exec(t);
  const close = new RegExp(`(?:ending|closing|new|final|carried forward|end(?:ing)? balance|balance at end|closing ledger)${gap}${money}`, "i").exec(t);
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
    const year = month > endMonth ? endYear - 1 : endYear;
    r[dateCol] = `${m[1]}/${m[2]}/${year}`;
  }
}
