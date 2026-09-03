import test from "node:test";
import assert from "node:assert/strict";
import type { Liability, Settings } from "@hawl/core-types";
import { valueLiability, resolveSettings } from "../src/index.js";

function value(liability: Liability, settings: Settings = resolveSettings("hanafi"), anniversary = "2026-03-01") {
  const warnings: string[] = [];
  const trace = valueLiability(liability, { settings, anniversary, warnings });
  return { trace, warnings };
}

test("R5.1 / R5.4 immediate debts fully deductible", () => {
  const { trace } = value({ kind: "immediate", id: "t", label: "Tax owed", amount: 1500 });
  assert.equal(trace.zakatable, 1500);
  assert.deepEqual(trace.rules, ["R5.1", "R5.4"]);
});

test("R5.2 long-term loan deducts next 12 instalments by default", () => {
  const { trace } = value({ kind: "long-term-loan", id: "m", label: "Mortgage", outstandingBalance: 300000, monthlyInstalment: 1800 });
  assert.equal(trace.zakatable, 21600);
  assert.equal(trace.input, 300000);
});

test("R5.2 twelve instalments are capped at the outstanding balance", () => {
  const { trace } = value({ kind: "long-term-loan", id: "c", label: "Car loan", outstandingBalance: 4000, monthlyInstalment: 500 });
  assert.equal(trace.zakatable, 4000);
});

test("R5.2 full-balance option deducts everything", () => {
  const { trace } = value({ kind: "long-term-loan", id: "m", label: "Mortgage", outstandingBalance: 300000, monthlyInstalment: 1800 }, resolveSettings("hanafi", { longTermDebtRule: "full-balance" }));
  assert.equal(trace.zakatable, 300000);
});

test("R5.3 credit card full balance deductible", () => {
  const { trace } = value({ kind: "credit-card", id: "cc", label: "Visa", balance: 2345.67 });
  assert.equal(trace.zakatable, 2345.67);
});

test("R5.5 upcoming bill not deductible by default", () => {
  const { trace } = value({ kind: "upcoming-bill", id: "r", label: "Rent", amount: 2000, dueDate: "2026-03-05" });
  assert.equal(trace.zakatable, 0);
});

test("R5.5 current-month option deducts bills due within 30 days only", () => {
  const s = resolveSettings("hanafi", { upcomingBillsRule: "current-month" });
  assert.equal(value({ kind: "upcoming-bill", id: "r", label: "Rent", amount: 2000, dueDate: "2026-03-05" }, s).trace.zakatable, 2000);
  assert.equal(value({ kind: "upcoming-bill", id: "r", label: "Rent", amount: 2000, dueDate: "2026-03-31" }, s).trace.zakatable, 2000);
  assert.equal(value({ kind: "upcoming-bill", id: "r", label: "Insurance", amount: 900, dueDate: "2026-05-01" }, s).trace.zakatable, 0);
  assert.equal(value({ kind: "upcoming-bill", id: "r", label: "Past due", amount: 900, dueDate: "2026-02-20" }, s).trace.zakatable, 0);
});

test("R5.5 current-month with no due date assumes deductible and warns", () => {
  const s = resolveSettings("hanafi", { upcomingBillsRule: "current-month" });
  const { trace, warnings } = value({ kind: "upcoming-bill", id: "u", label: "Utilities", amount: 150 }, s);
  assert.equal(trace.zakatable, 150);
  assert.equal(trace.estimated, true);
  assert.equal(warnings.length, 1);
});

test("R5.6 / R7.3 unpaid zakat from prior years is deductible", () => {
  const { trace } = value({ kind: "unpaid-zakat", id: "z", label: "Last year", amount: 320, forYear: "1446" });
  assert.equal(trace.zakatable, 320);
  assert.deepEqual(trace.rules, ["R5.6", "R7.3"]);
});

test("negative inputs never produce a negative deduction", () => {
  const { trace } = value({ kind: "immediate", id: "x", label: "Oops", amount: -50 });
  assert.equal(trace.zakatable, 0);
});
