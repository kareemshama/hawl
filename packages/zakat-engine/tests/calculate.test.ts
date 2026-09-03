import test from "node:test";
import assert from "node:assert/strict";
import { calculateZakat, resolveSettings, addDays, LUNAR_YEAR_DAYS } from "../src/index.js";
import { baseInput, ANNIVERSARY } from "./fixtures.js";

test("R14.2 verdict due: net above nisab, hawl complete, 2.5 percent", () => {
  const r = calculateZakat(baseInput(undefined, {
    assets: [{ kind: "cash", id: "c", label: "Savings", amount: 10000 }],
    liabilities: [{ kind: "credit-card", id: "cc", label: "Visa", balance: 2000 }],
  }));
  assert.equal(r.verdict, "due");
  assert.equal(r.totals.zakatableAssets, 10000);
  assert.equal(r.totals.deductibleLiabilities, 2000);
  assert.equal(r.totals.netZakatableWealth, 8000);
  assert.equal(r.nisab.value, 595);
  assert.equal(r.zakatDue, 200);
});

test("R14.2 verdict exempt: net below nisab", () => {
  const r = calculateZakat(baseInput(undefined, {
    assets: [{ kind: "cash", id: "c", label: "Savings", amount: 594.99 }],
  }));
  assert.equal(r.verdict, "exempt");
  assert.equal(r.zakatDue, 0);
});

test("R14.2 exactly at nisab is due", () => {
  const r = calculateZakat(baseInput(undefined, { assets: [{ kind: "cash", id: "c", label: "S", amount: 595 }] }));
  assert.equal(r.verdict, "due");
  assert.equal(r.zakatDue, 14.88);
});

test("R14.2 liabilities can push a wealthy-looking user under nisab", () => {
  const r = calculateZakat(baseInput(undefined, {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }],
    liabilities: [{ kind: "immediate", id: "d", label: "Hospital bill", amount: 4500 }],
  }));
  assert.equal(r.totals.netZakatableWealth, 500);
  assert.equal(r.verdict, "exempt");
});

test("R1.3 gold nisab makes a modest saver exempt where silver would not", () => {
  const assets = [{ kind: "cash" as const, id: "c", label: "S", amount: 3000 }];
  assert.equal(calculateZakat(baseInput(resolveSettings("hanafi"), { assets })).verdict, "due");
  assert.equal(calculateZakat(baseInput(resolveSettings("hanafi", { nisabMetal: "gold" }), { assets })).verdict, "exempt");
});

test("R3.2 gregorian calendar basis applies the solar rate", () => {
  const r = calculateZakat(baseInput(resolveSettings("hanafi", { calendarBasis: "gregorian" }), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 10000 }],
  }));
  assert.equal(r.rate, 0.025775);
  assert.equal(r.zakatDue, 257.75);
});

test("R6.2 minor is not liable under Hanafi, liable under the majority", () => {
  const assets = [{ kind: "cash" as const, id: "c", label: "Child savings", amount: 5000 }];
  const hanafi = calculateZakat(baseInput(resolveSettings("hanafi"), { assets, payer: { isMinor: true } }));
  assert.equal(hanafi.verdict, "not-liable");
  assert.equal(hanafi.zakatDue, 0);
  const shafii = calculateZakat(baseInput(resolveSettings("shafii"), { assets, payer: { isMinor: true } }));
  assert.equal(shafii.verdict, "due");
  assert.equal(shafii.zakatDue, 125);
});

test("R2.2 continuous rule with a dip yields hawl-not-complete and zero due", () => {
  const start = addDays(ANNIVERSARY.gregorian, -LUNAR_YEAR_DAYS);
  const series = [];
  for (let i = 0; i <= LUNAR_YEAR_DAYS; i++) series.push({ date: addDays(start, i), total: i === 100 ? 0 : 5000 });
  const r = calculateZakat(baseInput(resolveSettings("shafii", { newIncomeRule: "merge" }), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 5000 }],
    balanceSeries: series,
  }));
  assert.equal(r.verdict, "hawl-not-complete");
  assert.equal(r.zakatDue, 0);
  assert.equal(r.totals.netZakatableWealth, 5000);
  assert.ok(r.hawl?.proposedAnniversary);
});

test("R2.3 separate rule caps cash at the lowest balance of the year", () => {
  const start = addDays(ANNIVERSARY.gregorian, -LUNAR_YEAR_DAYS);
  const series = [];
  for (let i = 0; i <= LUNAR_YEAR_DAYS; i++) series.push({ date: addDays(start, i), total: 2000 + i * 10 }); // rises from 2000 to 5540
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [{ kind: "cash", id: "c", label: "S", amount: 5540 }],
    balanceSeries: series,
  }));
  const adj = r.traces.find((t) => t.id === "new-income-adjustment");
  assert.ok(adj);
  assert.equal(adj.zakatable, -3540);
  assert.equal(r.totals.zakatableAssets, 2000);
  assert.equal(r.verdict, "due");
  assert.equal(r.zakatDue, 50);
});

test("R2.3 separate rule does not touch non-cash assets", () => {
  const start = addDays(ANNIVERSARY.gregorian, -LUNAR_YEAR_DAYS);
  const series = [];
  for (let i = 0; i <= LUNAR_YEAR_DAYS; i++) series.push({ date: addDays(start, i), total: 1000 });
  const r = calculateZakat(baseInput(resolveSettings("shafii"), {
    assets: [
      { kind: "cash", id: "c", label: "S", amount: 1000 },
      { kind: "crypto", id: "b", label: "BTC", marketValue: 9000 },
    ],
    balanceSeries: series,
  }));
  assert.equal(r.traces.find((t) => t.id === "new-income-adjustment"), undefined);
  assert.equal(r.totals.zakatableAssets, 10000);
});

test("R15.7 every trace cites rules and the result records price and date provenance", () => {
  const r = calculateZakat(baseInput(undefined, {
    assets: [
      { kind: "cash", id: "c", label: "S", amount: 1000, source: { file: "chase.csv", line: 88 } },
      { kind: "metal", id: "g", label: "Ring", metal: "gold", grams: 5, purity: 0.75, usage: "personal-jewellery" },
    ],
    liabilities: [{ kind: "credit-card", id: "cc", label: "Visa", balance: 100 }],
  }));
  for (const t of r.traces) assert.ok(t.rules.length > 0, t.id);
  assert.equal(r.traces.find((t) => t.id === "c")?.source?.file, "chase.csv");
  assert.equal(r.prices.source, "test-fixture");
  assert.equal(r.anniversary.hijri, "12 Ramadan 1447");
  const ids = r.traces.map((t) => t.id);
  for (const required of ["nisab", "rate", "hawl", "total"]) assert.ok(ids.includes(required), required);
});

test("worked example: salaried US Muslim, Hanafi preset", () => {
  const r = calculateZakat(baseInput(resolveSettings("hanafi"), {
    assets: [
      { kind: "cash", id: "chk", label: "Checking", amount: 4200 },
      { kind: "cash", id: "sav", label: "Savings", amount: 18000 },
      { kind: "retirement", id: "k", label: "401k", vestedBalance: 60000, unvestedBalance: 5000, accessible: true, penaltyRate: 0.1, taxRate: 0.24 },
      { kind: "stock", id: "etf", label: "Index ETF", marketValue: 12000, intent: "long-term" },
      { kind: "metal", id: "ring", label: "Wife's gold", metal: "gold", grams: 30, purity: 0.9167, usage: "personal-jewellery", ownershipShare: 0 },
      { kind: "crypto", id: "eth", label: "ETH", marketValue: 1500 },
    ],
    liabilities: [
      { kind: "credit-card", id: "cc", label: "Amex", balance: 1300 },
      { kind: "long-term-loan", id: "car", label: "Car loan", outstandingBalance: 14000, monthlyInstalment: 420 },
      { kind: "upcoming-bill", id: "rent", label: "Rent", amount: 2100, dueDate: "2026-03-05" },
    ],
  }));
  // cash 22200 + 401k 60000*(1-0.34)=39600 + etf 3000 + ring 0 (owned by spouse) + eth 1500 = 66300
  assert.equal(r.totals.zakatableAssets, 66300);
  // amex 1300 + car 12*420=5040 + rent 0 = 6340
  assert.equal(r.totals.deductibleLiabilities, 6340);
  assert.equal(r.totals.netZakatableWealth, 59960);
  assert.equal(r.verdict, "due");
  assert.equal(r.zakatDue, 1499);
});
