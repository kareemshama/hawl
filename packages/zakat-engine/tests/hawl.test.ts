import test from "node:test";
import assert from "node:assert/strict";
import type { DailyBalance } from "@hawl/core-types";
import { evaluateHawl, resolveSettings, addDays, LUNAR_YEAR_DAYS } from "../src/index.js";

const ANNIVERSARY = "2026-03-01";
const START = addDays(ANNIVERSARY, -LUNAR_YEAR_DAYS); // 2025-03-12
const NISAB = 595;

/** Build a daily series from start to anniversary with a function of day index. */
function series(f: (i: number, date: string) => number): DailyBalance[] {
  const out: DailyBalance[] = [];
  for (let i = 0; i <= LUNAR_YEAR_DAYS; i++) {
    const date = addDays(START, i);
    out.push({ date, total: f(i, date) });
  }
  return out;
}

test("R2.1 default hawl window is one lunar year (354 days) before the anniversary", () => {
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: series(() => 1000) });
  assert.equal(s.checkedDays, LUNAR_YEAR_DAYS + 1);
  assert.equal(s.complete, true);
});

test("no balance history: hawl assumed complete and marked estimated", () => {
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY });
  assert.equal(s.complete, true);
  assert.equal(s.estimated, true);
  assert.equal(s.checkedDays, 0);
});

test("R2.2 Hanafi start-and-end: a mid-year dip does not break the hawl", () => {
  const dip = series((i) => (i > 100 && i < 130 ? 100 : 1000));
  const s = evaluateHawl({ settings: resolveSettings("hanafi"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: dip });
  assert.equal(s.complete, true);
  assert.equal(s.lowestTotal, 100);
  assert.equal(s.brokenOn, undefined);
});

test("R2.2 continuous: a dip breaks the hawl and reports the date", () => {
  const dip = series((i) => (i === 200 ? 500 : 1000));
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: dip });
  assert.equal(s.complete, false);
  assert.equal(s.brokenOn, addDays(START, 200));
  assert.equal(s.restartedOn, addDays(START, 201));
  assert.equal(s.proposedAnniversary, addDays(addDays(START, 201), LUNAR_YEAR_DAYS));
});

test("R2.2 continuous: dip with no recovery has no restart date", () => {
  const drop = series((i) => (i >= 300 ? 100 : 1000));
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: drop });
  assert.equal(s.complete, false);
  assert.equal(s.brokenOn, addDays(START, 300));
  assert.equal(s.restartedOn, undefined);
});

test("R2.2 continuous: early dip followed by a full lunar year above nisab is complete with a moved anniversary", () => {
  // Use a two-year series so the restart happened more than 354 days before the anniversary.
  const start = addDays(ANNIVERSARY, -400);
  const long: DailyBalance[] = [];
  for (let i = 0; i <= 400; i++) {
    long.push({ date: addDays(start, i), total: i === 10 ? 0 : 1000 });
  }
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, hawlStart: start, series: long });
  assert.equal(s.complete, true);
  assert.equal(s.brokenOn, addDays(start, 10));
  assert.equal(s.restartedOn, addDays(start, 11));
  assert.match(s.note, /Move the anniversary/);
});

test("per-day nisab values are used when supplied and clear the estimated flag", () => {
  const withNisab = series((i) => 700).map((d) => ({ ...d, nisabValue: 650 }));
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: withNisab });
  assert.equal(s.estimated, false);
  assert.equal(s.complete, true);
  const higher = withNisab.map((d, i) => (i === 50 ? { ...d, nisabValue: 800 } : d));
  const broken = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: higher });
  assert.equal(broken.complete, false);
  assert.equal(broken.brokenOn, addDays(START, 50));
});

test("days outside the hawl window are ignored", () => {
  const outside: DailyBalance[] = [{ date: addDays(START, -5), total: 0 }, { date: addDays(ANNIVERSARY, 3), total: 0 }];
  const s = evaluateHawl({ settings: resolveSettings("shafii"), nisabValue: NISAB, anniversary: ANNIVERSARY, series: [...outside, ...series(() => 1000)] });
  assert.equal(s.complete, true);
  assert.equal(s.checkedDays, LUNAR_YEAR_DAYS + 1);
});
