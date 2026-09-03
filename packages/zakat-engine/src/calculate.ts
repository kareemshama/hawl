import type { CalculationInput, CalculationResult, Trace, Verdict } from "@hawl/core-types";
import { evaluateHawl } from "./hawl.js";
import { valueLiability } from "./liabilities.js";
import { computeNisab, nisabTrace, rateFor, rateTrace } from "./nisab.js";
import { valueAsset } from "./valuation.js";
import { round2 } from "./util.js";

/**
 * The main entry point. Pure and deterministic (R14.2).
 *
 * net = zakatable assets - deductible liabilities
 * due if net >= nisab and the hawl is complete and the payer is liable.
 */
export function calculateZakat(input: CalculationInput): CalculationResult {
  const { settings, prices } = input;
  const warnings: string[] = [];
  const traces: Trace[] = [];

  // Nisab and rate (R1, R3)
  const nisab = computeNisab(settings, prices);
  traces.push(nisabTrace(nisab, prices));
  const rate = rateFor(settings);
  traces.push(rateTrace(settings));

  // Payer (R6)
  const payerExempt =
    settings.minorsRule === "exempt" && (input.payer?.isMinor === true || input.payer?.lacksCapacity === true);
  if (input.payer?.isMinor || input.payer?.lacksCapacity) {
    traces.push({
      id: "payer",
      label: payerExempt ? "Payer not personally liable" : "Payer's wealth liable via guardian",
      category: "payer",
      input: 0,
      zakatable: 0,
      rules: ["R6.1", "R6.2"],
      note: payerExempt
        ? "Hanafi position: minors and those lacking capacity are not liable."
        : "Majority position: the wealth itself is liable; the guardian pays from it.",
    });
  }

  // Assets (R4, R8 to R13)
  const assetCtx = { settings, prices, warnings };
  const assetTraces = input.assets.map((a) => valueAsset(a, assetCtx));
  traces.push(...assetTraces);
  let zakatableAssets = assetTraces.reduce((s, t) => s + t.zakatable, 0);

  // R2.3 separate-hawl rule: only cash held for the whole year has completed its own hawl.
  // The lowest total across the hawl is the standard practical proxy for that amount (R15.2).
  if (settings.newIncomeRule === "separate" && input.balanceSeries && input.balanceSeries.length > 0) {
    const cashTotal = assetTraces
      .filter((t) => input.assets.find((a) => a.id === t.id)?.kind === "cash")
      .reduce((s, t) => s + t.zakatable, 0);
    const window = input.balanceSeries.filter(
      (d) => d.date <= input.anniversary.gregorian && (input.hawlStart === undefined || d.date >= input.hawlStart),
    );
    if (window.length > 0 && cashTotal > 0) {
      const lowest = Math.min(...window.map((d) => d.total));
      if (lowest < cashTotal) {
        const reduction = round2(cashTotal - Math.max(0, lowest));
        traces.push({
          id: "new-income-adjustment",
          label: "Cash acquired during the year (separate hawl)",
          category: "adjustment",
          input: cashTotal,
          zakatable: -reduction,
          rules: ["R2.3", "R15.2"],
          note: `Lowest cash total during the hawl was ${round2(Math.max(0, lowest))}; the excess has not completed its own hawl.`,
          estimated: true,
        });
        zakatableAssets -= reduction;
        warnings.push("Separate-hawl rule applied using the lowest balance during the year as a proxy for wealth held the full year.");
      }
    }
  }

  // Liabilities (R5)
  const liabilityCtx = { settings, anniversary: input.anniversary.gregorian, warnings };
  const liabilityTraces = input.liabilities.map((l) => valueLiability(l, liabilityCtx));
  traces.push(...liabilityTraces);
  const deductibleLiabilities = liabilityTraces.reduce((s, t) => s + t.zakatable, 0);

  const net = round2(zakatableAssets - deductibleLiabilities);
  zakatableAssets = round2(zakatableAssets);

  // Hawl (R2)
  const hawl = evaluateHawl({
    settings,
    nisabValue: nisab.value,
    anniversary: input.anniversary.gregorian,
    hawlStart: input.hawlStart,
    series: input.balanceSeries,
  });
  traces.push({
    id: "hawl",
    label: hawl.complete ? "Hawl complete" : "Hawl not complete",
    category: "hawl",
    input: hawl.checkedDays,
    zakatable: 0,
    rules: settings.hawlDipRule === "continuous" ? ["R2.1", "R2.2", "R15.2"] : ["R2.1", "R2.2", "R15.1"],
    note: hawl.note,
    estimated: hawl.estimated,
  });

  // Verdict
  let verdict: Verdict;
  if (payerExempt) verdict = "not-liable";
  else if (net < nisab.value) verdict = "exempt";
  else if (!hawl.complete) verdict = "hawl-not-complete";
  else verdict = "due";

  const zakatDue = verdict === "due" ? round2(net * rate) : 0;

  traces.push({
    id: "total",
    label: verdict === "due" ? "Zakat due" : `No zakat due (${verdict})`,
    category: "total",
    input: net,
    zakatable: zakatDue,
    rules: ["R14.2"],
    note: `Net zakatable wealth ${net} vs nisab ${nisab.value}.`,
  });

  return {
    verdict,
    nisab,
    totals: { zakatableAssets, deductibleLiabilities: round2(deductibleLiabilities), netZakatableWealth: net },
    rate,
    zakatDue,
    hawl,
    traces,
    warnings,
    settings,
    anniversary: input.anniversary,
    prices,
  };
}
