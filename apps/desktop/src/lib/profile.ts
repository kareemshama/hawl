import type { Asset, CalculationResult, Liability, Madhab, MetalPrices, Payer, Settings } from "@hawl/core-types";
import { resolveSettings } from "@hawl/zakat-engine";

export interface HijriAnniversary {
  /** 1 to 12 */
  month: number;
  /** 1 to 30 */
  day: number;
}

export interface SavedYear {
  hijriYear: number;
  hijriLabel: string;
  gregorian: string;
  savedAt: string;
  result: CalculationResult;
  paid: boolean;
  paidOn?: string;
}

export interface Profile {
  version: 1;
  setupComplete: boolean;
  currency: string;
  madhab: Madhab;
  overrides: Partial<Settings>;
  anniversary: HijriAnniversary;
  /** Hijri year being calculated. Undefined means the most recent anniversary on or before today. */
  calcYear?: number;
  /** Optional Gregorian date the current hawl began (for the continuous dip rule). */
  hawlStart?: string;
  payer: Payer;
  assets: Asset[];
  liabilities: Liability[];
  manualPrices: MetalPrices | null;
  cachedPrices: MetalPrices | null;
  history: SavedYear[];
}

export function emptyProfile(): Profile {
  return {
    version: 1,
    setupComplete: false,
    currency: "USD",
    madhab: "hanafi",
    overrides: {},
    anniversary: { month: 9, day: 1 },
    payer: {},
    assets: [],
    liabilities: [],
    manualPrices: null,
    cachedPrices: null,
    history: [],
  };
}

/** Fill defaults for a profile loaded from an older store. */
export function normalizeProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<Profile>;
  return {
    ...base,
    ...p,
    version: 1,
    overrides: p.overrides ?? {},
    anniversary: p.anniversary ?? base.anniversary,
    payer: p.payer ?? {},
    assets: Array.isArray(p.assets) ? p.assets : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    history: Array.isArray(p.history) ? p.history : [],
    manualPrices: p.manualPrices ?? null,
    cachedPrices: p.cachedPrices ?? null,
  };
}

export function settingsOf(p: Profile): Settings {
  return resolveSettings(p.madhab, p.overrides);
}

export function pricesOf(p: Profile): MetalPrices | null {
  return p.manualPrices ?? p.cachedPrices;
}

export const CURRENCIES = [
  ["USD", "US dollar"],
  ["GBP", "British pound"],
  ["EUR", "Euro"],
  ["CAD", "Canadian dollar"],
  ["AUD", "Australian dollar"],
  ["CHF", "Swiss franc"],
  ["SEK", "Swedish krona"],
  ["NOK", "Norwegian krone"],
  ["DKK", "Danish krone"],
  ["INR", "Indian rupee"],
  ["MYR", "Malaysian ringgit"],
  ["SGD", "Singapore dollar"],
  ["ZAR", "South African rand"],
  ["TRY", "Turkish lira"],
  ["IDR", "Indonesian rupiah"],
  ["JPY", "Japanese yen"],
] as const;

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
