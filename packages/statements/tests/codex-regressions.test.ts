/**
 * Regression tests for the defects found in the Codex review of the statement parser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { StatementAccount, StatementImport, Transaction } from "@hawl/core-types";
import { parseAmount, parseCsvText, detectMapping, tableToTransactions, accountBalancePoints, balanceOn, buildBalanceSeries, deriveCashAssets } from "../src/index.js";

function tx(accountId: string, date: string, amount: number, balanceAfter?: number): Transaction {
  return { id: `${accountId}-${date}-${amount}`, accountId, date, amount, description: "x", ...(balanceAfter !== undefined ? { balanceAfter } : {}), source: { file: "f", confidence: "high" } };
}
function imp(accountId: string, file: string, periodStart: string, periodEnd: string, opening?: number, closing?: number): StatementImport {
  return { id: file, accountId, file, format: "pdf", importedAt: "", periodStart, periodEnd, ...(opening !== undefined ? { openingBalance: opening } : {}), ...(closing !== undefined ? { closingBalance: closing } : {}), transactionCount: 0, balanceVerified: false, notes: [] };
}
const chk: StatementAccount = { id: "chk", name: "Checking", kind: "checking", currency: "USD" };

test("double negative markers mean negative, never positive", () => {
  assert.equal(parseAmount("-100.00-"), -100);
  assert.equal(parseAmount("(-100.00)"), -100);
  assert.equal(parseAmount("(−100.00)"), -100);
  assert.equal(parseAmount("-45.20 DR"), -45.2);
});

test("newest-first files that keep same-day rows in posting order are reordered without breaking the balance chain", () => {
  // Chronological truth: 09/02 bal 950 -> 09/03 withdrawal -50 (900) -> 09/03 deposit +100 (1000).
  // The bank lists days newest-first but same-day rows oldest-first.
  const csv = `Date,Description,Amount,Balance
09/03/2026,WITHDRAWAL,-50.00,900.00
09/03/2026,DEPOSIT,100.00,1000.00
09/02/2026,OPENING,50.00,950.00
`;
  const table = parseCsvText(csv);
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, { accountId: "a", file: "f.csv" });
  assert.equal(r.balanceVerified, true, r.warnings.join(" "));
  assert.deepEqual(r.transactions.map((t) => t.balanceAfter), [950, 900, 1000]);
});

test("newest-first files that are newest-first within the day are fully reversed", () => {
  const csv = `Date,Description,Amount,Balance
09/03/2026,DEPOSIT,100.00,1000.00
09/03/2026,WITHDRAWAL,-50.00,900.00
09/02/2026,OPENING,50.00,950.00
`;
  const table = parseCsvText(csv);
  const r = tableToTransactions(table, detectMapping(table, "mdy").mapping!, { accountId: "a", file: "f.csv" });
  assert.equal(r.balanceVerified, true, r.warnings.join(" "));
  assert.deepEqual(r.transactions.map((t) => t.balanceAfter), [950, 900, 1000]);
});

test("the latest closing balance anchors an account and newer transactions walk forward from it", () => {
  const txns = [tx("chk", "2026-02-10", 1000)];
  const imports = [imp("chk", "jan.pdf", "2026-01-01", "2026-01-31", undefined, 1000), imp("chk", "feb.pdf", "2026-02-01", "2026-02-28", undefined, 2000)];
  const { points } = accountBalancePoints(chk, txns, imports);
  assert.equal(balanceOn(points, "2026-02-28"), 2000);
  assert.equal(balanceOn(points, "2026-02-05"), 1000);
  // A transaction after the latest statement is added on top of its closing balance.
  const later = [...txns, tx("chk", "2026-03-05", 500)];
  const p2 = accountBalancePoints(chk, later, imports).points;
  assert.equal(balanceOn(p2, "2026-03-10"), 2500);
});

test("an account in another currency is left out without a rate and converted with one", () => {
  const eur: StatementAccount = { id: "eur", name: "Euro savings", kind: "savings", currency: "EUR" };
  const txns = [tx("chk", "2026-01-01", 0, 1000), tx("eur", "2026-01-01", 0, 1000)];
  const without = buildBalanceSeries({ accounts: [chk, eur], transactions: txns, imports: [], from: "2026-01-01", to: "2026-01-01", baseCurrency: "USD" });
  assert.equal(without.series[0]!.total, 1000);
  assert.ok(without.warnings.some((w) => /no exchange rate/.test(w)));
  assert.equal(without.coverage.find((c) => c.accountId === "eur")!.converted, false);
  const d0 = deriveCashAssets({ accounts: [chk, eur], transactions: txns, imports: [], date: "2026-01-01", baseCurrency: "USD" });
  assert.equal(d0.assets.length, 1);
  assert.deepEqual(d0.unconverted.map((a) => a.id), ["eur"]);

  const withRate = { ...eur, fxRateToBase: 1.1 };
  const series = buildBalanceSeries({ accounts: [chk, withRate], transactions: txns, imports: [], from: "2026-01-01", to: "2026-01-01", baseCurrency: "USD" });
  assert.equal(series.series[0]!.total, 2100);
  const d1 = deriveCashAssets({ accounts: [chk, withRate], transactions: txns, imports: [], date: "2026-01-01", baseCurrency: "USD" });
  assert.equal((d1.assets[1] as { amount: number }).amount, 1100);
  assert.match(d1.assets[1]!.source?.note ?? "", /1.1 USD per EUR/);
});

test("a joint account share scales both the series and the derived asset", () => {
  const joint: StatementAccount = { id: "j", name: "Joint", kind: "checking", currency: "USD", ownershipShare: 0.5 };
  const txns = [tx("j", "2026-01-01", 0, 20000)];
  const s = buildBalanceSeries({ accounts: [joint], transactions: txns, imports: [], from: "2026-01-01", to: "2026-01-01", baseCurrency: "USD" });
  assert.equal(s.series[0]!.total, 10000);
  const d = deriveCashAssets({ accounts: [joint], transactions: txns, imports: [], date: "2026-01-01", baseCurrency: "USD" });
  // The derived asset keeps the full balance and the share; the engine applies the share (R6.3).
  assert.equal((d.assets[0] as { amount: number }).amount, 20000);
  assert.equal(d.assets[0]!.ownershipShare, 0.5);
});
