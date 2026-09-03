import type { DailyBalance, HawlStatus, IsoDate, Settings } from "@hawl/core-types";
import { yearLengthFor } from "./nisab.js";
import { addDays, daysBetween, parseIsoDate, round2 } from "./util.js";

interface Args {
  settings: Settings;
  nisabValue: number;
  anniversary: IsoDate;
  hawlStart?: IsoDate | undefined;
  series?: DailyBalance[] | undefined;
  /**
   * Zakatable value of non-cash assets at the anniversary. The dip test is about total zakatable
   * wealth (R2.1, R2.2), but statements only give cash history, so this is added to every day's
   * cash total as an approximation and the result is marked estimated.
   */
  nonCashZakatable?: number | undefined;
}

/**
 * Evaluate whether the hawl condition is met (R2.1, R2.2, R15.1, R15.2).
 *
 * Under "start-and-end" a dip never breaks the hawl; the series is only used for information.
 * Under "continuous" every day below nisab breaks it. The hawl restarts on the next day at or
 * above nisab after the LAST dip. If a full zakat year has passed since that restart by the
 * anniversary, the hawl is complete and zakat fell due one year after the restart.
 */
export function evaluateHawl({ settings, nisabValue, anniversary, hawlStart, series, nonCashZakatable }: Args): HawlStatus {
  const rule = settings.hawlDipRule;
  const yearLength = yearLengthFor(settings);
  const windowStart = hawlStart ?? addDays(anniversary, -yearLength);
  const nonCash = nonCashZakatable ?? 0;

  const window = (series ?? [])
    .filter((d) => d.date >= windowStart && d.date <= anniversary)
    .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));

  if (window.length === 0) {
    return {
      rule,
      complete: true,
      windowStart,
      effectiveStart: windowStart,
      checkedDays: 0,
      dipCount: 0,
      estimated: true,
      note:
        series && series.length > 0
          ? "No balance data inside the hawl window; assumed complete."
          : "No balance history supplied; hawl assumed complete on the user's word.",
    };
  }

  const totalOf = (d: DailyBalance) => d.total + nonCash;
  const nisabOf = (d: DailyBalance) => d.nisabValue ?? nisabValue;

  let lowest = window[0]!;
  let usedEstimate = nonCash > 0;
  for (const d of window) {
    if (totalOf(d) < totalOf(lowest)) lowest = d;
    if (d.nisabValue === undefined) usedEstimate = true;
  }
  const nonCashNote = nonCash > 0 ? ` Non-cash zakatable assets of ${round2(nonCash)} valued at the anniversary were added to each day's cash total as an approximation.` : "";

  const common = {
    rule,
    windowStart,
    checkedDays: window.length,
    lowestTotal: round2(totalOf(lowest)),
    lowestOn: lowest.date,
    estimated: usedEstimate,
  };

  if (rule === "start-and-end") {
    return {
      ...common,
      complete: true,
      effectiveStart: windowStart,
      dipCount: 0,
      note: `Only the start and end of the hawl are checked; mid-year dips do not break it.${nonCashNote}`,
    };
  }

  // Continuous rule: scan the whole window, remembering the last dip and the restart after it.
  let dipCount = 0;
  let inDip = false;
  /** First day of the most recent dip. */
  let lastBreak: DailyBalance | undefined;
  /** First day at or above nisab after the most recent dip. */
  let restart: DailyBalance | undefined;
  for (const d of window) {
    if (totalOf(d) < nisabOf(d)) {
      if (!inDip) {
        dipCount += 1;
        lastBreak = d;
      }
      inDip = true;
      restart = undefined;
    } else if (inDip) {
      inDip = false;
      restart = d;
    }
  }

  if (!lastBreak) {
    return { ...common, complete: true, effectiveStart: windowStart, dipCount: 0, note: `Wealth stayed at or above nisab for the whole hawl.${nonCashNote}` };
  }

  const dips = dipCount === 1 ? "once" : `${dipCount} times`;

  if (!restart) {
    return {
      ...common,
      complete: false,
      effectiveStart: windowStart,
      dipCount,
      brokenOn: lastBreak.date,
      note: `Wealth fell below nisab ${dips}, most recently on ${lastBreak.date}, and has not returned above it.${nonCashNote}`,
    };
  }

  const proposedAnniversary = addDays(restart.date, yearLength);
  const elapsed = daysBetween(restart.date, anniversary);
  if (elapsed >= yearLength) {
    return {
      ...common,
      complete: true,
      effectiveStart: restart.date,
      dipCount,
      brokenOn: lastBreak.date,
      restartedOn: restart.date,
      proposedAnniversary,
      note: `Wealth fell below nisab ${dips}, last on ${lastBreak.date}, and recovered on ${restart.date}. A full year has since passed, so zakat fell due on ${proposedAnniversary}. Move the anniversary to that date.${nonCashNote}`,
    };
  }
  return {
    ...common,
    complete: false,
    effectiveStart: restart.date,
    dipCount,
    brokenOn: lastBreak.date,
    restartedOn: restart.date,
    proposedAnniversary,
    note: `Wealth fell below nisab ${dips}, last on ${lastBreak.date}, and recovered on ${restart.date}. Zakat falls due around ${proposedAnniversary}.${nonCashNote}`,
  };
}
