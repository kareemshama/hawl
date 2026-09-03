import type { CalculationInput, CalculationResult, UnpaidZakat } from "@hawl/core-types";
import { calculateZakat } from "./calculate.js";
import { round2 } from "./util.js";

export interface MissedYearsResult {
  years: CalculationResult[];
  totalOwed: number;
}

/**
 * Reconstruct missed years (R7). Inputs must be ordered oldest first.
 * Each year's unpaid zakat is carried into the next year as a deductible debt (R7.3).
 * The caller decides which of these years were actually unpaid; pass `paid` to skip carrying one.
 */
export function calculateMissedYears(
  inputs: CalculationInput[],
  options: { paid?: Set<number> } = {},
): MissedYearsResult {
  const years: CalculationResult[] = [];
  const carried: UnpaidZakat[] = [];

  inputs.forEach((input, index) => {
    const result = calculateZakat({
      ...input,
      liabilities: [...input.liabilities, ...carried],
    });
    years.push(result);
    if (result.zakatDue > 0 && !options.paid?.has(index)) {
      carried.push({
        kind: "unpaid-zakat",
        id: `unpaid-${index}`,
        label: `Unpaid zakat (${input.anniversary.hijri ?? input.anniversary.gregorian})`,
        amount: result.zakatDue,
        forYear: input.anniversary.hijri ?? input.anniversary.gregorian,
      });
    }
  });

  return { years, totalOwed: round2(carried.reduce((s, c) => s + c.amount, 0)) };
}
