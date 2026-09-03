import type { CalculationInput, MetalPrices, Settings } from "@hawl/core-types";
import { resolveSettings } from "../src/index.js";

/** Round prices so expected values are easy to read: silver nisab = 595, gold nisab = 8500. */
export const PRICES: MetalPrices = {
  currency: "USD",
  goldPerGram: 100,
  silverPerGram: 1,
  asOf: "2026-03-01",
  source: "test-fixture",
};

export const ANNIVERSARY = { gregorian: "2026-03-01", hijri: "12 Ramadan 1447" };

export function baseInput(settings: Settings = resolveSettings("hanafi"), extra: Partial<CalculationInput> = {}): CalculationInput {
  return {
    settings,
    anniversary: ANNIVERSARY,
    prices: PRICES,
    assets: [],
    liabilities: [],
    ...extra,
  };
}
