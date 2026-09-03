import test from "node:test";
import assert from "node:assert/strict";
import { calculateMissedYears, resolveSettings } from "../src/index.js";
import { baseInput } from "./fixtures.js";

const settings = resolveSettings("hanafi");

function year(hijri: string, gregorian: string, cash: number) {
  return baseInput(settings, {
    anniversary: { hijri, gregorian },
    assets: [{ kind: "cash", id: "c", label: "Savings", amount: cash }],
  });
}

test("R7.1 / R7.2 each missed year is computed on that year's wealth", () => {
  const { years } = calculateMissedYears([
    year("1445", "2024-03-22", 10000),
    year("1446", "2025-03-11", 20000),
  ]);
  assert.equal(years.length, 2);
  assert.equal(years[0]!.zakatDue, 250);
});

test("R7.3 unpaid zakat cascades as a debt into the following year", () => {
  const { years, totalOwed } = calculateMissedYears([
    year("1445", "2024-03-22", 10000),
    year("1446", "2025-03-11", 20000),
    year("1447", "2026-03-01", 20000),
  ]);
  // Year 1: 10000 x 2.5% = 250
  assert.equal(years[0]!.zakatDue, 250);
  // Year 2: (20000 - 250) x 2.5% = 493.75
  assert.equal(years[1]!.totals.deductibleLiabilities, 250);
  assert.equal(years[1]!.zakatDue, 493.75);
  // Year 3: (20000 - 250 - 493.75) x 2.5% = 481.41
  assert.equal(years[2]!.totals.deductibleLiabilities, 743.75);
  assert.equal(years[2]!.zakatDue, 481.41);
  assert.equal(totalOwed, 1225.16);
});

test("R7.3 a year marked paid is not carried forward", () => {
  const { years, totalOwed } = calculateMissedYears(
    [year("1445", "2024-03-22", 10000), year("1446", "2025-03-11", 20000)],
    { paid: new Set([0]) },
  );
  assert.equal(years[1]!.totals.deductibleLiabilities, 0);
  assert.equal(years[1]!.zakatDue, 500);
  assert.equal(totalOwed, 500);
});

test("R7 exempt years carry nothing forward", () => {
  const { years, totalOwed } = calculateMissedYears([
    year("1445", "2024-03-22", 100),
    year("1446", "2025-03-11", 20000),
  ]);
  assert.equal(years[0]!.verdict, "exempt");
  assert.equal(years[1]!.zakatDue, 500);
  assert.equal(totalOwed, 500);
});
