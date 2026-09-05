import { test } from "node:test";
import assert from "node:assert/strict";
import { daysInclusive, mergeIntervals, monthCells, uncovered } from "../src/lib/coverage.js";

test("mergeIntervals joins touching and overlapping periods", () => {
  const merged = mergeIntervals([
    { from: "2025-11-04", to: "2025-12-05" },
    { from: "2025-09-05", to: "2025-10-06" },
    { from: "2025-10-07", to: "2025-11-03" },
  ]);
  assert.deepEqual(merged, [{ from: "2025-09-05", to: "2025-12-05" }]);
});

test("uncovered lists the gaps inside a window, including the ends", () => {
  const gaps = uncovered([{ from: "2025-09-05", to: "2025-10-06" }, { from: "2025-11-04", to: "2025-12-05" }], "2025-09-01", "2025-12-31");
  assert.deepEqual(gaps, [
    { from: "2025-09-01", to: "2025-09-04" },
    { from: "2025-10-07", to: "2025-11-03" },
    { from: "2025-12-06", to: "2025-12-31" },
  ]);
});

test("uncovered is empty when the window is fully covered", () => {
  assert.deepEqual(uncovered([{ from: "2025-01-01", to: "2026-01-01" }], "2025-03-01", "2025-12-31"), []);
});

test("monthCells marks full, partial, and empty months", () => {
  const cells = monthCells([{ from: "2025-09-05", to: "2025-10-31" }], "2025-09-01", "2025-11-30");
  assert.equal(cells.length, 3);
  assert.equal(cells[0]!.state, "partial");
  assert.equal(cells[0]!.coveredDays, 26);
  assert.equal(cells[1]!.state, "full");
  assert.equal(cells[2]!.state, "none");
});

test("monthCells clips the first and last month to the window", () => {
  const cells = monthCells([{ from: "2025-09-10", to: "2025-09-20" }], "2025-09-10", "2025-09-20");
  assert.equal(cells.length, 1);
  assert.equal(cells[0]!.days, 11);
  assert.equal(cells[0]!.state, "full");
});

test("daysInclusive counts both ends and never goes negative", () => {
  assert.equal(daysInclusive("2025-12-31", "2026-01-01"), 2);
  assert.equal(daysInclusive("2026-01-02", "2026-01-01"), 0);
});
