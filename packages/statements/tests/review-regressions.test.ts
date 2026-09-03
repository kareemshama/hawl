/**
 * Regression tests for the defects found in the code review of the statements package.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Transaction } from "@hawl/core-types";
import type { PdfTextItem } from "../src/index.js";
import { itemsToRows, rowsToTable, detectMapping, tableToTransactions, dedupeIncoming, completeYears } from "../src/index.js";

function row(page: number, y: number, cells: [number, string][]): PdfTextItem[] {
  return cells.map(([x, str]) => ({ page, x, y, width: Math.max(10, str.length * 5), str }));
}

function tx(id: string, date: string, amount: number, description: string, balanceAfter?: number): Transaction {
  return { id, accountId: "a", date, amount, description, ...(balanceAfter !== undefined ? { balanceAfter } : {}), source: { file: "f", confidence: "high" } };
}

test("dedupe: two distinct same-day same-amount rows in one file both survive", () => {
  const incoming = [tx("1", "2026-01-05", -4.5, "STARBUCKS #1234", 995.5), tx("2", "2026-01-05", -4.5, "STARBUCKS #1234", 991)];
  const { fresh, skipped } = dedupeIncoming([], incoming);
  assert.equal(fresh.length, 2);
  assert.equal(skipped.length, 0);
});

test("dedupe: same transaction with a longer PDF description is recognized via the balance key", () => {
  const existing = [tx("csv", "2026-01-03", -1850, "RENT PAYMENT OAKWOOD PROPERTIES", 14346.63)];
  const incoming = [tx("pdf", "2026-01-03", -1850, "RENT PAYMENT OAKWOOD PROPERTIES REF 000088 ONLINE PAYMENT", 14346.63)];
  const { fresh, skipped } = dedupeIncoming(existing, incoming);
  assert.equal(fresh.length, 0);
  assert.equal(skipped.length, 1);
});

test("dedupe: each existing row absorbs at most one duplicate, so a net-zero pair does not swallow a third row", () => {
  const existing = [tx("e1", "2026-01-05", -100, "TRANSFER TO SAVINGS", 900), tx("e2", "2026-01-05", 100, "TRANSFER FROM SAVINGS", 1000)];
  const incoming = [
    tx("i1", "2026-01-05", -100, "TRANSFER TO SAVINGS", 900),
    tx("i2", "2026-01-05", 100, "TRANSFER FROM SAVINGS", 1000),
    tx("i3", "2026-01-05", -100, "CARD PAYMENT", 900),
  ];
  const { fresh, skipped } = dedupeIncoming(existing, incoming);
  assert.deepEqual(fresh.map((t) => t.id), ["i3"]);
  assert.equal(skipped.length, 2);
});

test("dedupe: full description is compared, not a 24-character prefix", () => {
  const existing = [tx("e", "2026-01-05", -12, "CARD PURCHASE STARBUCKS STORE 1234")];
  const incoming = [tx("i", "2026-01-05", -12, "CARD PURCHASE STARBUCKS STORE 5678")];
  assert.equal(dedupeIncoming(existing, incoming).fresh.length, 1);
});

test("header words with punctuation or plurals still map, and 'Withdrawal Amount' is one column", () => {
  const items: PdfTextItem[] = [
    ...row(1, 720, [[50, "Date"], [120, "Description"], [340, "Withdrawal Amount"], [440, "Deposit Amount"], [540, "Balance:"]]),
    ...row(1, 700, [[50, "01/03"], [120, "COSTCO"], [395, "120.00"], [560, "880.00"]]),
    ...row(1, 680, [[50, "01/05"], [120, "PAYROLL"], [485, "2,500.00"], [555, "3,380.00"]]),
    ...row(1, 660, [[50, "01/07"], [120, "AMAZON"], [400, "45.20"], [555, "3,334.80"]]),
  ];
  const { table, notes } = rowsToTable(itemsToRows(items));
  assert.deepEqual(table.headers, ["Date", "Description", "Debit", "Credit", "Balance"], notes.join(" "));
  assert.deepEqual(table.rows[0], ["01/03", "COSTCO", "120.00", "", "880.00"]);
  assert.deepEqual(table.rows[1], ["01/05", "PAYROLL", "", "2,500.00", "3,380.00"]);
  completeYears(table, 0, { periodEnd: "2026-01-31" });
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 1000 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-120, 2500, -45.2]);
  assert.equal(r.balanceVerified, true);
});

test("a description item that ends with a money-like token is not split when amounts are separate items", () => {
  const items: PdfTextItem[] = [
    ...row(1, 700, [[50, "03 Jan 2026"], [150, "AMAZON EU 12.50 EUR RATE 1.15"], [420, "10.87"], [520, "989.13"]]),
    ...row(1, 680, [[50, "04 Jan 2026"], [150, "SALARY"], [420, "2,500.00"], [520, "3,489.13"]]),
    ...row(1, 660, [[50, "05 Jan 2026"], [150, "RENT"], [420, "1,200.00"], [520, "2,289.13"]]),
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.deepEqual(table.headers, ["Date", "Description", "Amount", "Balance"]);
  assert.equal(table.rows[0]![1], "AMAZON EU 12.50 EUR RATE 1.15");
  const r = tableToTransactions(table, detectMapping(table, "dmy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 1000 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-10.87, 2500, -1200]);
  assert.equal(r.balanceVerified, true);
});

test("a continuation line containing an amount is still appended when it has no trailing money item", () => {
  const items: PdfTextItem[] = [
    ...row(1, 720, [[50, "Date"], [120, "Description"], [380, "Withdrawals"], [460, "Deposits"], [540, "Balance"]]),
    ...row(1, 700, [[50, "01/03"], [120, "AMAZON EU SARL LUXEMBOURG"], [385, "10.87"], [545, "989.13"]]),
    ...row(1, 686, [[120, "12.50 EUR RATE 1.15"]]),
    ...row(1, 672, [[50, "01/05"], [120, "PAYROLL"], [462, "2,500.00"], [545, "3,489.13"]]),
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows[0]![1], "AMAZON EU SARL LUXEMBOURG 12.50 EUR RATE 1.15");
});

test("a dated detail line with no amounts is a continuation, not a dropped transaction", () => {
  const items: PdfTextItem[] = [
    ...row(1, 720, [[50, "Date"], [120, "Description"], [380, "Withdrawals"], [460, "Deposits"], [540, "Balance"]]),
    ...row(1, 700, [[50, "01/03"], [120, "CARD PURCHASE"], [385, "10.87"], [545, "989.13"]]),
    { page: 1, x: 120, y: 686, width: 120, str: "01/02 STARBUCKS SEATTLE" },
    ...row(1, 672, [[120, "CARD 1234"]]),
    ...row(1, 658, [[50, "01/05"], [120, "PAYROLL"], [462, "2,500.00"], [545, "3,489.13"]]),
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]![1], "CARD PURCHASE 01/02 STARBUCKS SEATTLE CARD 1234");
});

test("merged rows: last number takes the balance column by its exact right edge, the other gets its sign from the balance", () => {
  const items: PdfTextItem[] = [
    { page: 1, x: 50, y: 584, width: 500, str: "Date Description Withdrawals Deposits Balance" },
    { page: 1, x: 50, y: 568, width: 540, str: "01/01 PAYROLL ACME CORP DIRECT DEP 4,200.00 16,196.63" },
    { page: 1, x: 50, y: 554, width: 540, str: "01/03 RENT PAYMENT OAKWOOD PROPERTIES 1,850.00 14,346.63" },
    { page: 1, x: 50, y: 526, width: 540, str: "01/07 COSTCO WHSE #0412 96.20 14,250.43" },
  ];
  const { table, notes } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows[0]![4], "16,196.63");
  assert.equal(table.rows[2]![4], "14,250.43");
  assert.ok(notes.some((n) => /direction of each amount was taken from the running balance/.test(n)));
  completeYears(table, 0, { periodEnd: "2026-01-31" });
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 11996.63 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [4200, -1850, -96.2]);
  assert.equal(r.balanceVerified, true);
});

test("merged rows without a balance column produce a warning about unknown direction", () => {
  const items: PdfTextItem[] = [
    { page: 1, x: 50, y: 584, width: 400, str: "Date Description Withdrawals Deposits" },
    { page: 1, x: 50, y: 568, width: 440, str: "01/01 PAYROLL ACME 4,200.00" },
    { page: 1, x: 50, y: 554, width: 440, str: "01/03 RENT 1,850.00" },
  ];
  const { table, notes } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows.length, 2);
  assert.ok(notes.some((n) => /could not be determined/.test(n)));
});

test("merged rows with multi-space padding keep the original offsets", () => {
  const items: PdfTextItem[] = [
    { page: 1, x: 50, y: 584, width: 500, str: "Date  Description                Withdrawals   Deposits    Balance" },
    { page: 1, x: 50, y: 568, width: 540, str: "01/01 PAYROLL ACME CORP DIRECT DEP            4,200.00   16,196.63" },
    { page: 1, x: 50, y: 554, width: 540, str: "01/07 COSTCO WHSE #0412             96.20                 14,250.43" },
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows[0]![1], "PAYROLL ACME CORP DIRECT DEP");
  assert.equal(table.rows[0]![4], "16,196.63");
  assert.equal(table.rows[1]![4], "14,250.43");
  assert.ok(table.rows[0]!.includes("4,200.00"));
  assert.ok(table.rows[1]!.includes("96.20"));
});

test("merged rows with European amounts are split using the shared money predicate", () => {
  const items: PdfTextItem[] = [
    { page: 1, x: 50, y: 680, width: 540, str: "03.01.2026 MIETE OAKWOOD 1.850,00 14.346,63" },
    { page: 1, x: 50, y: 666, width: 540, str: "05.01.2026 GEHALT ACME GMBH 3.200,00 17.546,63" },
  ];
  const { table } = rowsToTable(itemsToRows(items));
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.headers, ["Date", "Description", "Amount", "Balance"]);
  const r = tableToTransactions(table, detectMapping(table, "dmy").mapping!, { accountId: "a", file: "s.pdf", openingBalance: 16196.63 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-1850, 3200]);
});
