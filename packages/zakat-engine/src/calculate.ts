import type { CalculationInput, CalculationResult, Trace, Verdict } from "@hawl/core-types";
import { evaluateHawl } from "./hawl.js";
import { valueLiability } from "./liabilities.js";
import { computeNisab, nisabTrace, rateFor, rateTrace } from "./nisab.js";
import { valueAsset } from "./valuation.js";
import { assertFinite, metalPrice, round2 } from "./util.js";

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

  // Both prices must be valid even if only one drives nisab; the other values metal assets (R1.4).
  metalPrice(prices, "gold");
  metalPrice(prices, "silver");

  // settings.hijriAdjustmentDays (R2.6) is applied by the date layer that turns the Hijri
  // anniversary into input.anniversary.gregorian; the arithmetic here never touches it.

  // Nisab and rate (R1, R3)
  const nisab = computeNisab(settings, prices);
  traces.push(nisabTrace(nisab, prices));
  const rate = rateFor(settings);
  traces.push(rateTrace(settings));

  // Payer (R6)
  const payerFlagged = input.payer?.isMinor === true || input.payer?.lacksCapacity === true;
  const payerExempt = payerFlagged && settings.minorsRule === "exempt";
  if (payerFlagged) {
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

  // Assets (R4, R8 to R13). Traces are zipped with inputs by index, never by id.
  const assetCtx = { settings, prices, warnings };
  const assetTraces = input.assets.map((a) => valueAsset(a, assetCtx));
  traces.push(...assetTraces);
  for (const t of assetTraces) assertFinite(t.zakatable, `Asset "${t.label}" value`);
  let zakatableAssets = assetTraces.reduce((s, t) => s + t.zakatable, 0);

  let cashRaw = 0;
  let cashZakatable = 0;
  input.assets.forEach((a, i) => {
    if (a.kind === "cash") {
      cashRaw += a.amount;
      cashZakatable += assetTraces[i]!.zakatable;
    }
  });
  const nonCashZakatable = round2(zakatableAssets - cashZakatable);

  // Hawl (R2). Runs before the separate-income cap so the cap can respect a restarted hawl.
  const hawl = evaluateHawl({
    settings,
    nisabValue: nisab.value,
    anniversary: input.anniversary.gregorian,
    hawlStart: input.hawlStart,
    series: input.balanceSeries,
    nonCashZakatable,
  });
  if (nonCashZakatable > 0 && hawl.checkedDays > 0 && settings.hawlDipRule === "continuous") {
    warnings.push("The dip test added non-cash assets at their anniversary value to each day's cash balance; their history is not known.");
  }

  // R2.3 separate-hawl rule: only cash held since the (possibly restarted) hawl began has completed
  // its own hawl. The lowest raw balance in that window is the standard practical proxy (R15.2).
  // The reduction is applied proportionally so ownership shares are respected.
  if (settings.newIncomeRule === "separate" && input.balanceSeries && cashRaw > 0) {
    const window = input.balanceSeries.filter((d) => d.date >= hawl.effectiveStart && d.date <= input.anniversary.gregorian);
    if (window.length > 0) {
      const lowestRaw = Math.max(0, Math.min(...window.map((d) => d.total)));
      if (lowestRaw < cashRaw) {
        const fraction = (cashRaw - lowestRaw) / cashRaw;
        const reduction = round2(cashZakatable * fraction);
        traces.push({
          id: "new-income-adjustment",
          label: "Cash acquired during the year (separate hawl)",
          category: "adjustment",
          input: round2(cashZakatable),
          zakatable: -reduction,
          rules: ["R2.3", "R15.2"],
          note: `Lowest cash total since ${hawl.effectiveStart} was ${round2(lowestRaw)} of ${round2(cashRaw)}; the ${Math.round(fraction * 1000) / 10} percent above it has not completed its own hawl.`,
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
  for (const t of liabilityTraces) assertFinite(t.zakatable, `Liability "${t.label}" value`);
  const deductibleLiabilities = round2(liabilityTraces.reduce((s, t) => s + t.zakatable, 0));

  zakatableAssets = round2(zakatableAssets);
  const net = assertFinite(round2(zakatableAssets - deductibleLiabilities), "Net zakatable wealth");

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
  else if (!hawl.complete) verdict = "hawl-not-complete";
  else if (net < nisab.value) verdict = "exempt";
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
    totals: { zakatableAssets, deductibleLiabilities, netZakatableWealth: net },
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
