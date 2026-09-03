import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvText, detectMapping, tableToTransactions } from "../src/index.js";

const OPTS = { accountId: "acct", file: "test.csv" };

test("Chase-style CSV: signed amount, running balance, newest first", () => {
  const csv = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,01/07/2026,"AMAZON MKTPL*ABC123",-45.20,DEBIT_CARD,4954.80,
CREDIT,01/05/2026,"PAYROLL ACME CORP",2500.00,ACH_CREDIT,5000.00,
DEBIT,01/03/2026,"COSTCO WHSE #123",-120.00,DEBIT_CARD,2500.00,
`;
  const table = parseCsvText(csv);
  assert.deepEqual(table.headers, ["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]);
  const guess = detectMapping(table, "mdy");
  assert.equal(guess.confidence, "high");
  assert.equal(guess.mapping?.date, 1);
  assert.equal(guess.mapping?.description, 2);
  assert.equal(guess.mapping?.amount, 3);
  assert.equal(guess.mapping?.balance, 5);
  const r = tableToTransactions(table, guess.mapping!, OPTS);
  assert.equal(r.transactions.length, 3);
  assert.equal(r.transactions[0]!.date, "2026-01-03");
  assert.equal(r.transactions[2]!.date, "2026-01-07");
  assert.equal(r.transactions[2]!.amount, -45.2);
  assert.equal(r.transactions[2]!.balanceAfter, 4954.8);
  assert.equal(r.balanceVerified, true);
  assert.ok(r.warnings.some((w) => /newest-first/.test(w)));
});

test("HSBC-style CSV: separate Paid out / Paid in columns, DD/MM/YYYY, unsigned", () => {
  const csv = `Date,Description,Paid out,Paid in,Balance
25/01/2026,TESCO STORES,32.10,,1467.90
26/01/2026,SALARY,,2000.00,3467.90
27/01/2026,RENT,1200.00,,2267.90
`;
  const table = parseCsvText(csv);
  const guess = detectMapping(table, "dmy");
  assert.equal(guess.mapping?.debit, 2);
  assert.equal(guess.mapping?.credit, 3);
  assert.equal(guess.mapping?.balance, 4);
  assert.equal(guess.mapping?.dateOrder, "dmy");
  const r = tableToTransactions(table, guess.mapping!, OPTS);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-32.1, 2000, -1200]);
  assert.equal(r.transactions[0]!.date, "2026-01-25");
  assert.equal(r.balanceVerified, true);
});

test("unsigned single amount column gets its sign from the balance movement", () => {
  const csv = `Date,Description,Amount,Balance
2026-02-01,Opening,100.00,1100.00
2026-02-02,Groceries,40.00,1060.00
2026-02-03,Refund,15.00,1075.00
`;
  const table = parseCsvText(csv);
  const guess = detectMapping(table, "mdy");
  const r = tableToTransactions(table, guess.mapping!, OPTS);
  assert.deepEqual(r.transactions.map((t) => t.amount), [100, -40, 15]);
  assert.equal(r.balanceVerified, true);
});

test("running-balance mismatch is reported and marks that row low confidence", () => {
  const csv = `Date,Description,Amount,Balance
2026-02-01,A,-10.00,990.00
2026-02-02,B,-10.00,975.00
2026-02-03,C,-10.00,965.00
`;
  const table = parseCsvText(csv);
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, OPTS);
  assert.equal(r.balanceVerified, false);
  assert.deepEqual(r.mismatches, [3]);
  assert.equal(r.transactions[1]!.source.confidence, "low");
  assert.equal(r.transactions[2]!.source.confidence, "medium");
});

test("headerless CSV is mapped from content, with the balance found by differencing", () => {
  const csv = `01/02/2026,STARBUCKS,-5.25,994.75
01/03/2026,VENMO CASHOUT,50.00,1044.75
01/04/2026,UBER,-18.50,1026.25
`;
  const table = parseCsvText(csv);
  assert.equal(table.headers, null);
  const guess = detectMapping(table, "mdy");
  assert.ok(guess.mapping, guess.reasons.join(" "));
  assert.equal(guess.mapping!.date, 0);
  assert.equal(guess.mapping!.description, 1);
  assert.equal(guess.mapping!.amount, 2);
  assert.equal(guess.mapping!.balance, 3);
  assert.equal(guess.confidence, "medium");
});

test("preamble lines and blank lines are skipped, semicolon delimiter handled", () => {
  const csv = `Acme Bank
Account: 12345678

Date;Description;Amount
05.01.2026;Miete;-950,00
06.01.2026;Gehalt;3.200,00
`;
  const table = parseCsvText(csv);
  assert.deepEqual(table.headers, ["Date", "Description", "Amount"]);
  assert.equal(table.rows.length, 2);
  const r = tableToTransactions(table, detectMapping(table, "dmy").mapping!, OPTS);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-950, 3200]);
  assert.equal(r.transactions[0]!.date, "2026-01-05");
});

test("Monzo-style CSV with many columns and a signed amount", () => {
  const csv = `Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In
tx_1,01/02/2026,09:12:01,Card payment,Pret,,Eating out,-4.50,GBP,-4.50,GBP,,,,PRET A MANGER,,-4.50,
tx_2,02/02/2026,17:00:00,Faster payment,Employer,,Income,2100.00,GBP,2100.00,GBP,,,,SALARY,,,2100.00
`;
  const table = parseCsvText(csv);
  const guess = detectMapping(table, "dmy");
  assert.equal(guess.mapping?.date, 1);
  assert.equal(guess.mapping?.amount, 7);
  const r = tableToTransactions(table, guess.mapping!, OPTS);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-4.5, 2100]);
  assert.equal(r.transactions[0]!.description, "PRET A MANGER");
});

test("mapping returns null with reasons when no amount column exists", () => {
  const table = parseCsvText("Date,Note\n2026-01-01,hello\n2026-01-02,world\n");
  const guess = detectMapping(table, "mdy");
  assert.equal(guess.mapping, null);
  assert.ok(guess.reasons.length > 0);
});
