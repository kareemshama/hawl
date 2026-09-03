import test from "node:test";
import assert from "node:assert/strict";
import type { StatementAccount, StatementImport, Transaction } from "@hawl/core-types";
import { buildBalanceSeries, accountBalancePoints, balanceOn, lowestPoint } from "../src/index.js";

const chk: StatementAccount = { id: "chk", name: "Checking", kind: "checking", currency: "USD" };
const sav: StatementAccount = { id: "sav", name: "Savings", kind: "savings", currency: "USD", ownershipShare: 0.5 };
const cc: StatementAccount = { id: "cc", name: "Visa", kind: "credit-card", currency: "USD" };

function tx(accountId: string, date: string, amount: number, balanceAfter?: number): Transaction {
  return { id: `${accountId}-${date}-${amount}`, accountId, date, amount, description: "x", ...(balanceAfter !== undefined ? { balanceAfter } : {}), source: { file: "f", confidence: "high" } };
}

test("running balances carry forward day by day and credit cards are excluded", () => {
  const txns = [tx("chk", "2026-01-02", -10, 990), tx("chk", "2026-01-05", 100, 1090), tx("cc", "2026-01-03", -500, 500)];
  const r = buildBalanceSeries({ accounts: [chk, cc], transactions: txns, imports: [], from: "2026-01-01", to: "2026-01-06" });
  assert.deepEqual(r.series.map((d) => [d.date, d.total]), [
    ["2026-01-02", 990],
    ["2026-01-03", 990],
    ["2026-01-04", 990],
    ["2026-01-05", 1090],
    ["2026-01-06", 1090],
  ]);
  assert.ok(r.warnings.some((w) => /history starts 2026-01-02/.test(w)));
});

test("ownership share scales an account's contribution", () => {
  const txns = [tx("chk", "2026-01-01", 0, 1000), tx("sav", "2026-01-01", 0, 4000)];
  const r = buildBalanceSeries({ accounts: [chk, sav], transactions: txns, imports: [], from: "2026-01-01", to: "2026-01-01" });
  assert.equal(r.series[0]!.total, 3000);
  assert.equal(r.perAccount["sav"]![0]!.total, 2000);
});

test("accounts without running balances are anchored on a closing balance and walked backward", () => {
  const txns = [tx("chk", "2026-01-03", -120), tx("chk", "2026-01-05", 2500), tx("chk", "2026-01-07", -45.2)];
  const imp: StatementImport = { id: "i", accountId: "chk", file: "f", format: "pdf", importedAt: "", periodStart: "2026-01-01", periodEnd: "2026-01-31", closingBalance: 4954.8, transactionCount: 3, balanceVerified: false, notes: [] };
  const { points, anchored } = accountBalancePoints(chk, txns, [imp]);
  assert.equal(anchored, true);
  assert.equal(balanceOn(points, "2026-01-31"), 4954.8);
  assert.equal(balanceOn(points, "2026-01-06"), 5000);
  assert.equal(balanceOn(points, "2026-01-04"), 2500);
  assert.equal(balanceOn(points, "2026-01-02"), 2620);
  assert.equal(balanceOn(points, "2025-12-01"), null);
});

test("opening balance anchor walks forward", () => {
  const txns = [tx("chk", "2026-01-03", -120), tx("chk", "2026-01-05", 2500)];
  const imp: StatementImport = { id: "i", accountId: "chk", file: "f", format: "csv", importedAt: "", periodStart: "2026-01-01", openingBalance: 2620, transactionCount: 2, balanceVerified: false, notes: [] };
  const { points } = accountBalancePoints(chk, txns, [imp]);
  assert.equal(balanceOn(points, "2026-01-01"), 2620);
  assert.equal(balanceOn(points, "2026-01-03"), 2500);
  assert.equal(balanceOn(points, "2026-01-10"), 5000);
});

test("unanchored transactions are excluded with a warning", () => {
  const r = buildBalanceSeries({ accounts: [chk], transactions: [tx("chk", "2026-01-03", -120)], imports: [], from: "2026-01-01", to: "2026-01-05" });
  assert.equal(r.series.length, 0);
  assert.ok(r.warnings.some((w) => /left out/.test(w)));
  assert.equal(r.coverage[0]!.anchored, false);
});

test("lowestPoint finds the dip", () => {
  assert.deepEqual(lowestPoint([{ date: "a", total: 5 }, { date: "b", total: 2 }, { date: "c", total: 9 }]), { date: "b", total: 2 });
  assert.equal(lowestPoint([]), null);
});
