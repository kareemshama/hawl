import type { Madhab, Settings } from "@hawl/core-types";

/**
 * The practical default per R2.4: fixed anniversary, merge new income, silver nisab.
 * This is what "Custom" starts from.
 */
export const DEFAULT_SETTINGS: Settings = {
  madhab: "custom",
  nisabMetal: "silver", // R1.3
  nisabStandard: "standard", // R1.1, R1.2
  hawlDipRule: "start-and-end", // R2.2
  newIncomeRule: "merge", // R2.3, R2.4
  calendarBasis: "hijri", // R2.5, R3.2
  jewelleryRule: "zakatable", // R4.3
  longTermDebtRule: "next-12-months", // R5.2
  upcomingBillsRule: "not-deductible", // R5.5
  retirementMethod: "net-accessible", // R8.2
  stockProxyPercent: 25, // R9.2
  minorsRule: "exempt", // R6.2
  hijriAdjustmentDays: 0, // R2.6
};

/**
 * Madhab presets. Each preset applies that school's documented positions from RULES.md.
 * Where the schools agree, or where a contemporary consensus exists, the shared default is used.
 */
export const PRESETS: Record<Exclude<Madhab, "custom">, Settings> = {
  hanafi: {
    ...DEFAULT_SETTINGS,
    madhab: "hanafi",
    hawlDipRule: "start-and-end", // R2.2
    newIncomeRule: "merge", // R2.3
    jewelleryRule: "zakatable", // R4.3
    minorsRule: "exempt", // R6.2
  },
  shafii: {
    ...DEFAULT_SETTINGS,
    madhab: "shafii",
    hawlDipRule: "continuous", // R2.2
    newIncomeRule: "separate", // R2.3
    jewelleryRule: "personal-use-exempt", // R4.3
    minorsRule: "liable", // R6.2
  },
  maliki: {
    ...DEFAULT_SETTINGS,
    madhab: "maliki",
    hawlDipRule: "continuous",
    newIncomeRule: "separate",
    jewelleryRule: "personal-use-exempt",
    minorsRule: "liable",
  },
  hanbali: {
    ...DEFAULT_SETTINGS,
    madhab: "hanbali",
    hawlDipRule: "continuous",
    newIncomeRule: "separate",
    jewelleryRule: "personal-use-exempt",
    minorsRule: "liable",
  },
};

/** Build settings from a preset plus individual overrides (RULES.md Part 4). */
export function resolveSettings(madhab: Madhab, overrides: Partial<Settings> = {}): Settings {
  const base = madhab === "custom" ? DEFAULT_SETTINGS : PRESETS[madhab];
  const merged: Settings = { ...base, ...overrides, madhab };
  if (!(merged.stockProxyPercent >= 0 && merged.stockProxyPercent <= 100)) {
    throw new RangeError(`stockProxyPercent must be between 0 and 100, got ${merged.stockProxyPercent}`);
  }
  return merged;
}
