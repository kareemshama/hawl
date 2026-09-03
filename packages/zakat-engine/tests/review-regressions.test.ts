/**
 * Regression tests for the defects found in the first adversarial code review of the engine.
 * Each test names the rule it protects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { DailyBalance } from "@hawl/core-types";
import { calculateZakat, evaluateHawl, valueAsset, valueLiability, resolveSettings, addDays, LUNAR_YEAR_DAYS, DEFAULT_SETTINGS } from "../src/index.js";
import { parseIsoDate } from "../src/util.js";
import { baseInput, ANNIVERSARY, PRICES } from "./fixtures.js";

const A = ANNIVERSARY.gregorian;

function flat(startOffsetDays: number, total: number, override: (i: number) => number | undefined = () => undefined): DailyBalance[] {
  const start = addDays(A, -startOffsetDays);
  const out: DailyBalance[] = [];
  for (let i = 0; i <= startOffsetDays; i++) out.push({ date: addDays(start, i), total: override(i) ?? total });
  return out;
}

test("R2.3 separate-hawl cap ignores history older than the hawl window", () => {
  const old: DailyBalance[] = [{ date: "2020-01-01", total: 10 }, { date: addDays(A, -(LUNAR_YEAR_DAYS + 1)), total: 10 }];
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }],
    balanceSeries: [...old, ...flat(LUNAR_YEAR_DAYS, 5000)],
  }));
  assert.equal(r.traces.find((t) => t.id === "new-income-adjustment"), undefined);
  assert.equal(r.verdict, "due");
  assert.equal(r.zakatDue, 125);
});

test("R2.2 continuous: a second dip after a restart is detected", () => {
  const series = flat(400, 1000, (i) => (i === 10 || i === 380 ? 0 : undefined));
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: 595, anniversary: A, hawlStart: addDays(A, -400), series });
  assert.equal(s.complete, false);
  assert.equal(s.dipCount, 2);
  assert.equal(s.brokenOn, addDays(addDays(A, -400), 380));
  assert.equal(s.restartedOn, addDays(addDays(A, -400), 381));
});

test("R2.2 continuous: a dip that runs to the anniversary reports the day it started", () => {
  const series = flat(LUNAR_YEAR_DAYS, 1000, (i) => (i >= 300 ? 100 : undefined));
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: 595, anniversary: A, series });
  assert.equal(s.complete, false);
  assert.equal(s.brokenOn, addDays(addDays(A, -LUNAR_YEAR_DAYS), 300));
  assert.equal(s.restartedOn, undefined);
});

test("R2.3 + R2.2: a dip does not turn a pending year into 'exempt'", () => {
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }],
    balanceSeries: flat(LUNAR_YEAR_DAYS, 5000, (i) => (i === 100 ? 0 : undefined)),
  }));
  assert.equal(r.verdict, "hawl-not-complete");
  assert.equal(r.totals.netZakatableWealth, 5000);
  assert.equal(r.traces.find((t) => t.id === "new-income-adjustment"), undefined);
});

test("R2.3 cap window starts at the restarted hawl, not at the dip", () => {
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 1000 }],
    hawlStart: addDays(A, -400),
    balanceSeries: flat(400, 1000, (i) => (i === 10 ? 0 : undefined)),
  }));
  assert.equal(r.hawl?.complete, true);
  assert.equal(r.verdict, "due");
  assert.equal(r.zakatDue, 25);
});

test("R2.2 dip test counts non-cash zakatable wealth, marked estimated", () => {
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [
      { kind: "metal", id: "g", label: "Bullion", metal: "gold", grams: 1000, purity: 1, usage: "bullion" },
      { kind: "cash", id: "c", label: "Checking", amount: 300 },
    ],
    balanceSeries: flat(LUNAR_YEAR_DAYS, 300, (i) => (i === 50 ? 0 : undefined)),
  }));
  assert.equal(r.hawl?.complete, true);
  assert.equal(r.hawl?.estimated, true);
  assert.equal(r.verdict, "due");
  assert.ok(r.warnings.some((w) => /non-cash/i.test(w)));
});

test("R2.3 + R6.3 cap is applied proportionally to a joint account", () => {
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [{ kind: "cash", id: "j", label: "Joint", amount: 10000, ownershipShare: 0.5 }],
    balanceSeries: flat(LUNAR_YEAR_DAYS, 10000, (i) => 6000 + Math.min(4000, i * 20)),
  }));
  const adj = r.traces.find((t) => t.id === "new-income-adjustment");
  assert.ok(adj);
  assert.equal(adj.zakatable, -2000);
  assert.equal(r.totals.zakatableAssets, 3000);
});

test("duplicate asset ids do not confuse the cash lookup", () => {
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [
      { kind: "crypto", id: "x", label: "BTC", marketValue: 9000 },
      { kind: "cash", id: "x", label: "Cash", amount: 1000 },
    ],
    balanceSeries: flat(LUNAR_YEAR_DAYS, 1000),
  }));
  assert.equal(r.traces.find((t) => t.id === "new-income-adjustment"), undefined);
  assert.equal(r.totals.zakatableAssets, 10000);
});

test("R1.4 an invalid gold price throws even when nisab is silver", () => {
  assert.throws(() => calculateZakat(baseInput(undefined, {
    prices: { ...PRICES, goldPerGram: Number.NaN },
    assets: [{ kind: "metal", id: "g", label: "Gold", metal: "gold", grams: 10, purity: 1, usage: "bullion" }],
  })), RangeError);
  assert.throws(() => calculateZakat(baseInput(undefined, { prices: { ...PRICES, goldPerGram: 0 } })), RangeError);
});

test("R3.2 gregorian basis uses a 365-day hawl window", () => {
  const series = flat(370, 5000, (i) => (i === 10 ? 0 : undefined)); // dip 360 days before the anniversary
  const hijri = calculateZakat(baseInput(resolveSettings("shafii", { newIncomeRule: "merge" }), { assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }], balanceSeries: series }));
  assert.equal(hijri.verdict, "due");
  const gregorian = calculateZakat(baseInput(resolveSettings("shafii", { newIncomeRule: "merge", calendarBasis: "gregorian" }), { assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }], balanceSeries: series }));
  assert.equal(gregorian.verdict, "hawl-not-complete");
  assert.equal(gregorian.hawl?.proposedAnniversary, addDays(addDays(A, -370), 11 + 365));
});

test("R13.4 529 never goes negative and warns when penalty plus tax swallow the balance", () => {
  const warnings: string[] = [];
  const t = valueAsset({ kind: "other-account", id: "e", label: "529", subtype: "education-529", balance: 10000, penaltyRate: 0.6, taxRate: 0.6 }, { settings: DEFAULT_SETTINGS, prices: PRICES, warnings });
  assert.equal(t.zakatable, 0);
  assert.equal(warnings.length, 1);
});

test("R8.2 retirement warns when rates look like whole percentages", () => {
  const warnings: string[] = [];
  const t = valueAsset({ kind: "retirement", id: "k", label: "401k", vestedBalance: 10000, accessible: true, penaltyRate: 10, taxRate: 24 }, { settings: DEFAULT_SETTINGS, prices: PRICES, warnings });
  assert.equal(t.zakatable, 0);
  assert.match(warnings[0] ?? "", /fractions/);
});

test("R5.4 an upcoming bill already due is deductible under both toggles", () => {
  for (const rule of ["not-deductible", "current-month"] as const) {
    const warnings: string[] = [];
    const t = valueLiability({ kind: "upcoming-bill", id: "r", label: "Rent", amount: 2100, dueDate: "2026-02-25" }, { settings: resolveSettings("hanafi", { upcomingBillsRule: rule }), anniversary: A, warnings });
    assert.equal(t.zakatable, 2100, rule);
    assert.deepEqual(t.rules, ["R5.4"], rule);
  }
});

test("R2.6 hijriAdjustmentDays is part of Settings with a zero default", () => {
  assert.equal(resolveSettings("hanafi").hijriAdjustmentDays, 0);
  assert.equal(resolveSettings("hanafi", { hijriAdjustmentDays: 1 }).hijriAdjustmentDays, 1);
});

test("parseIsoDate rejects impossible calendar dates", () => {
  assert.throws(() => parseIsoDate("2026-02-30"));
  assert.throws(() => parseIsoDate("2026-13-01"));
  assert.equal(parseIsoDate("2024-02-29"), Date.UTC(2024, 1, 29));
});
