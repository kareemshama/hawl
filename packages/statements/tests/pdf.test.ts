import test from "node:test";
import assert from "node:assert/strict";
import type { PdfTextItem } from "../src/index.js";
import { itemsToRows, rowsToTable, extractSummary, completeYears, detectMapping, tableToTransactions } from "../src/index.js";

/** Helper: lay out a row of strings at given x positions on one baseline. */
function row(page: number, y: number, cells: [number, string][]): PdfTextItem[] {
  return cells.map(([x, str]) => ({ page, x, y, width: Math.max(10, str.length * 5), str }));
}

test("itemsToRows groups by baseline within tolerance and orders left to right", () => {
  const items = [...row(1, 700, [[300, "b"], [50, "a"]]), ...row(1, 698.5, [[500, "c"]]), ...row(1, 650, [[50, "d"]])];
  const rows = itemsToRows(items);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.text, "a b c");
  assert.equal(rows[1]!.text, "d");
});

test("rowsToTable with a labelled header assigns numbers to debit, credit, balance by x position", () => {
  const items: PdfTextItem[] = [
    // Summary block above the table must not be mistaken for the column header.
    ...row(1, 780, [[50, "Beginning Balance"], [300, "$2,620.00"]]),
    ...row(1, 766, [[50, "Deposits and other credits"], [300, "2,500.00"]]),
    ...row(1, 752, [[50, "Withdrawals and other debits"], [300, "(165.20)"]]),
    ...row(1, 738, [[50, "Ending Balance"], [300, "$4,954.80"]]),
    ...row(1, 720, [[50, "Date"], [120, "Description"], [380, "Withdrawals"], [460, "Deposits"], [540, "Balance"]]),
    ...row(1, 700, [[50, "01/03"], [120, "COSTCO WHSE #123"], [385, "120.00"], [545, "2,500.00"]]),
    ...row(1, 680, [[50, "01/05"], [120, "PAYROLL ACME CORP"], [462, "2,500.00"], [545, "5,000.00"]]),
    ...row(1, 660, [[120, "DIRECT DEPOSIT REF 88"]]), // continuation line
    ...row(1, 640, [[50, "01/07"], [120, "AMAZON MKTPL*ABC"], [385, "45.20"], [545, "4,954.80"]]),
    ...row(1, 600, [[50, "Ending balance"], [545, "4,954.80"]]),
  ];
  const { table, pages, notes } = rowsToTable(itemsToRows(items));
  assert.deepEqual(table.headers, ["Date", "Description", "Debit", "Credit", "Balance"]);
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[0], ["01/03", "COSTCO WHSE #123", "120.00", "", "2,500.00"]);
  assert.deepEqual(table.rows[1], ["01/05", "PAYROLL ACME CORP DIRECT DEPOSIT REF 88", "", "2,500.00", "5,000.00"]);
  assert.deepEqual(pages, [1, 1, 1]);
  assert.ok(notes[0]?.includes("Header found"));

  completeYears(table, 0, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
  assert.equal(table.rows[0]![0], "01/03/2026");

  const guess = detectMapping(table, "mdy");
  assert.equal(guess.confidence, "high");
  const r = tableToTransactions(table, guess.mapping!, { accountId: "a", file: "s.pdf", pages });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-120, 2500, -45.2]);
  assert.equal(r.balanceVerified, true);
  assert.equal(r.transactions[0]!.source.page, 1);
});

test("rowsToTable without a header infers amount and balance columns", () => {
  const items: PdfTextItem[] = [
    ...row(1, 700, [[50, "05 Jan 2026"], [150, "TESCO STORES"], [420, "32.10"], [520, "1,467.90"]]),
    ...row(1, 680, [[50, "06 Jan 2026"], [150, "SALARY"], [420, "2,000.00"], [520, "3,467.90"]]),
    ...row(1, 660, [[50, "07 Jan 2026"], [150, "RENT"], [420, "1,200.00"], [520, "2,267.90"]]),
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.deepEqual(table.headers, ["Date", "Description", "Amount", "Balance"]);
  // Without an opening balance the first row's direction is unknown and a warning says so.
  const r0 = tableToTransactions(table, detectMapping(table, "dmy").mapping!, { accountId: "a", file: "s.pdf" });
  assert.deepEqual(r0.transactions.map((t) => t.amount), [32.1, 2000, -1200]);
  assert.ok(r0.warnings.some((w) => /first row/.test(w)));
  // With the summary's opening balance every sign is recovered from the balance movement.
  const r = tableToTransactions(table, detectMapping(table, "dmy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 1500 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-32.1, 2000, -1200]);
  assert.equal(r.balanceVerified, true);
});

test("completeYears rolls December back a year on a January statement", () => {
  const table = { headers: ["Date", "Description", "Amount"], rows: [["12/30", "x", "1.00"], ["01/02", "y", "1.00"]], lineNumbers: [1, 2] };
  completeYears(table, 0, { periodStart: "2025-12-28", periodEnd: "2026-01-27" });
  assert.equal(table.rows[0]![0], "12/30/2025");
  assert.equal(table.rows[1]![0], "01/02/2026");
});

test("extractSummary finds balances and the statement period", () => {
  const text = `ACME BANK Statement Period: 01/01/2026 to 01/31/2026
  Account Summary
  Beginning Balance $2,620.00
  Deposits and other credits 2,500.00
  Withdrawals and other debits (165.20)
  Ending Balance $4,954.80`;
  const s = extractSummary(text);
  assert.equal(s.openingBalance, 2620);
  assert.equal(s.closingBalance, 4954.8);
  assert.equal(s.periodStart, "2026-01-01");
  assert.equal(s.periodEnd, "2026-01-31");
});

test("extractSummary handles UK wording", () => {
  const text = `Your statement 5 January 2026 to 4 February 2026. Balance brought forward £1,500.00 ... Balance carried forward £2,267.90`;
  const s = extractSummary(text);
  assert.equal(s.openingBalance, 1500);
  assert.equal(s.closingBalance, 2267.9);
  assert.equal(s.periodStart, "2026-01-05");
  assert.equal(s.periodEnd, "2026-02-04");
});

test("rows merged into one text item by pdf.js are split back into columns", () => {
  const items: PdfTextItem[] = [
    { page: 1, x: 50, y: 584, width: 500, str: "Date Description Withdrawals Deposits Balance" },
    { page: 1, x: 50, y: 568, width: 540, str: "01/01 PAYROLL ACME CORP DIRECT DEP 4,200.00 16,196.63" },
    { page: 1, x: 50, y: 554, width: 540, str: "01/03 RENT PAYMENT OAKWOOD PROPERTIES 1,850.00 14,346.63" },
    { page: 1, x: 110, y: 540, width: 200, str: "REF 000088 ONLINE PAYMENT" },
    { page: 1, x: 50, y: 526, width: 540, str: "01/07 COSTCO WHSE #0412 96.20 14,250.43" },
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0]![0], "01/01");
  assert.equal(table.rows[0]![1], "PAYROLL ACME CORP DIRECT DEP");
  assert.match(table.rows[1]![1]!, /REF 000088 ONLINE PAYMENT$/);
  completeYears(table, 0, { periodStart: "2026-01-01", periodEnd: "2026-01-31" });
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 11996.63 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [4200, -1850, -96.2]);
  assert.equal(r.balanceVerified, true);
});
