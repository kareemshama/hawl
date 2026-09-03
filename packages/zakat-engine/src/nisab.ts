import type { MetalPrices, NisabMetal, NisabResult, NisabStandard, Settings, Trace } from "@hawl/core-types";
import { round2 } from "./util.js";

/** R1.1, R1.2 */
export const NISAB_GRAMS: Record<NisabStandard, Record<NisabMetal, number>> = {
  standard: { gold: 85, silver: 595 },
  strict: { gold: 87.48, silver: 612.36 },
};

/** R3.1, R3.2 */
export const LUNAR_RATE = 0.025;
export const SOLAR_RATE = 0.025775;
/** Mean Hijri year length in days, used for date arithmetic (R2.1). */
export const LUNAR_YEAR_DAYS = 354;

export function computeNisab(settings: Settings, prices: MetalPrices): NisabResult {
  const grams = NISAB_GRAMS[settings.nisabStandard][settings.nisabMetal];
  const pricePerGram = settings.nisabMetal === "gold" ? prices.goldPerGram : prices.silverPerGram;
  if (!(pricePerGram > 0)) {
    throw new RangeError(`Missing or invalid ${settings.nisabMetal} price per gram: ${pricePerGram}`);
  }
  return {
    metal: settings.nisabMetal,
    standard: settings.nisabStandard,
    grams,
    pricePerGram,
    value: round2(grams * pricePerGram),
  };
}

export function nisabTrace(nisab: NisabResult, prices: MetalPrices): Trace {
  return {
    id: "nisab",
    label: `Nisab (${nisab.grams} g ${nisab.metal})`,
    category: "nisab",
    input: nisab.pricePerGram,
    zakatable: nisab.value,
    rules: ["R1.1", "R1.2", "R1.3", "R1.4"],
    note: `${nisab.metal} at ${nisab.pricePerGram} ${prices.currency}/g from ${prices.source} on ${prices.asOf}`,
  };
}

export function rateFor(settings: Settings): number {
  return settings.calendarBasis === "gregorian" ? SOLAR_RATE : LUNAR_RATE;
}

export function rateTrace(settings: Settings): Trace {
  const rate = rateFor(settings);
  return {
    id: "rate",
    label: settings.calendarBasis === "gregorian" ? "Rate (solar year adjusted)" : "Rate (lunar year)",
    category: "rate",
    input: rate,
    zakatable: rate,
    rules: settings.calendarBasis === "gregorian" ? ["R3.1", "R3.2"] : ["R3.1"],
  };
}
