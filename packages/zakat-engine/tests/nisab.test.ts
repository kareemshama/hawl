import test from "node:test";
import assert from "node:assert/strict";
import { computeNisab, rateFor, resolveSettings, LUNAR_RATE, SOLAR_RATE, NISAB_GRAMS } from "../src/index.js";
import { PRICES } from "./fixtures.js";

test("R1.1 gold nisab standard is 85 g", () => {
  const n = computeNisab(resolveSettings("custom", { nisabMetal: "gold" }), PRICES);
  assert.equal(n.grams, 85);
  assert.equal(n.value, 8500);
});

test("R1.1 gold nisab strict is 87.48 g", () => {
  const n = computeNisab(resolveSettings("custom", { nisabMetal: "gold", nisabStandard: "strict" }), PRICES);
  assert.equal(n.grams, 87.48);
  assert.equal(n.value, 8748);
});

test("R1.2 silver nisab standard is 595 g", () => {
  const n = computeNisab(resolveSettings("custom"), PRICES);
  assert.equal(n.metal, "silver");
  assert.equal(n.grams, 595);
  assert.equal(n.value, 595);
});

test("R1.2 silver nisab strict is 612.36 g", () => {
  const n = computeNisab(resolveSettings("custom", { nisabStandard: "strict" }), PRICES);
  assert.equal(n.grams, 612.36);
  assert.equal(n.value, 612.36);
});

test("R1.3 default metal is silver for every preset", () => {
  for (const m of ["hanafi", "shafii", "maliki", "hanbali", "custom"] as const) {
    assert.equal(resolveSettings(m).nisabMetal, "silver", m);
  }
});

test("R1.4 nisab result records the price per gram used", () => {
  const n = computeNisab(resolveSettings("custom"), { ...PRICES, silverPerGram: 1.37 });
  assert.equal(n.pricePerGram, 1.37);
  assert.equal(n.value, 815.15);
});

test("R1.4 missing price throws instead of silently returning zero", () => {
  assert.throws(() => computeNisab(resolveSettings("custom"), { ...PRICES, silverPerGram: 0 }), RangeError);
});

test("NISAB_GRAMS table matches RULES.md", () => {
  assert.deepEqual(NISAB_GRAMS, { standard: { gold: 85, silver: 595 }, strict: { gold: 87.48, silver: 612.36 } });
});

test("R3.1 lunar rate is 2.5 percent", () => {
  assert.equal(rateFor(resolveSettings("hanafi")), 0.025);
  assert.equal(LUNAR_RATE, 0.025);
});

test("R3.2 gregorian basis uses 2.5775 percent", () => {
  assert.equal(rateFor(resolveSettings("hanafi", { calendarBasis: "gregorian" })), 0.025775);
  assert.equal(SOLAR_RATE, 0.025775);
  // Sanity: 2.5% x 365.25 / 354.367 ~ 2.5775%
  assert.ok(Math.abs(0.025 * (365.25 / 354.367) - SOLAR_RATE) < 0.00001);
});
