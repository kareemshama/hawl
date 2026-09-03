import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, PRESETS, resolveSettings } from "../src/index.js";

test("Hanafi preset follows R2.2, R2.3, R4.3, R6.2", () => {
  const s = PRESETS.hanafi;
  assert.equal(s.hawlDipRule, "start-and-end");
  assert.equal(s.newIncomeRule, "merge");
  assert.equal(s.jewelleryRule, "zakatable");
  assert.equal(s.minorsRule, "exempt");
});

test("Shafii, Maliki, Hanbali presets follow R2.2, R2.3, R4.3, R6.2", () => {
  for (const m of ["shafii", "maliki", "hanbali"] as const) {
    const s = PRESETS[m];
    assert.equal(s.hawlDipRule, "continuous", m);
    assert.equal(s.newIncomeRule, "separate", m);
    assert.equal(s.jewelleryRule, "personal-use-exempt", m);
    assert.equal(s.minorsRule, "liable", m);
  }
});

test("Shared contemporary defaults are identical across presets", () => {
  for (const m of ["hanafi", "shafii", "maliki", "hanbali"] as const) {
    const s = PRESETS[m];
    assert.equal(s.nisabStandard, "standard", m); // R1.1
    assert.equal(s.calendarBasis, "hijri", m); // R2.5
    assert.equal(s.longTermDebtRule, "next-12-months", m); // R5.2
    assert.equal(s.upcomingBillsRule, "not-deductible", m); // R5.5
    assert.equal(s.retirementMethod, "net-accessible", m); // R8.2
    assert.equal(s.stockProxyPercent, 25, m); // R9.2
  }
});

test("resolveSettings applies overrides and keeps the chosen madhab label", () => {
  const s = resolveSettings("shafii", { jewelleryRule: "zakatable", stockProxyPercent: 30 });
  assert.equal(s.madhab, "shafii");
  assert.equal(s.jewelleryRule, "zakatable");
  assert.equal(s.stockProxyPercent, 30);
  assert.equal(s.hawlDipRule, "continuous");
});

test("resolveSettings custom starts from DEFAULT_SETTINGS", () => {
  assert.deepEqual(resolveSettings("custom"), DEFAULT_SETTINGS);
});

test("resolveSettings rejects an out-of-range stock proxy", () => {
  assert.throws(() => resolveSettings("hanafi", { stockProxyPercent: 120 }), RangeError);
  assert.throws(() => resolveSettings("hanafi", { stockProxyPercent: -1 }), RangeError);
});
