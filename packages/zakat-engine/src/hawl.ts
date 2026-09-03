import type { DailyBalance, HawlStatus, IsoDate, Settings } from "@hawl/core-types";
import { LUNAR_YEAR_DAYS } from "./nisab.js";
import { addDays, daysBetween, parseIsoDate } from "./util.js";

interface Args {
  settings: Settings;
  nisabValue: number;
  anniversary: IsoDate;
  hawlStart?: IsoDate | undefined;
  series?: DailyBalance[] | undefined;
}

/**
 * Evaluate whether the hawl condition is met (R2.1, R2.2, R15.1, R15.2).
 *
 * Under "start-and-end" a dip never breaks the hawl; the series is only used for information.
 * Under "continuous" the first day below nisab breaks it. The hawl restarts on the next day at or
 * above nisab. If a full lunar year has passed since the restart by the anniversary, the hawl is
 * complete and the caller should move the anniversary to the restart date's Hijri equivalent.
 */
export function evaluateHawl({ settings, nisabValue, anniversary, hawlStart, series }: Args): HawlStatus {
  const rule = settings.hawlDipRule;
  const start = hawlStart ?? addDays(anniversary, -LUNAR_YEAR_DAYS);

  const window = (series ?? [])
    .filter((d) => d.date >= start && d.date <= anniversary)
    .sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));

  if (window.length === 0) {
    return {
      rule,
      complete: true,
      checkedDays: 0,
      estimated: true,
      note: series && series.length > 0
        ? "No balance data inside the hawl window; assumed complete."
        : "No balance history supplied; hawl assumed complete on the user's word.",
    };
  }

  let lowest = window[0]!;
  let usedEstimate = false;
  for (const d of window) {
    if (d.total < lowest.total) lowest = d;
    if (d.nisabValue === undefined) usedEstimate = true;
  }

  const common = {
    rule,
    checkedDays: window.length,
    lowestTotal: lowest.total,
    lowestOn: lowest.date,
    estimated: usedEstimate,
  };

  if (rule === "start-and-end") {
    return {
      ...common,
      complete: true,
      note: "Only the start and end of the hawl are checked; mid-year dips do not break it.",
    };
  }

  const firstBreak = window.find((d) => d.total < (d.nisabValue ?? nisabValue));
  if (!firstBreak) {
    return { ...common, complete: true, note: "Wealth stayed at or above nisab for the whole hawl." };
  }

  const restart = window.find((d) => d.date > firstBreak.date && d.total >= (d.nisabValue ?? nisabValue));
  if (!restart) {
    return {
      ...common,
      complete: false,
      brokenOn: firstBreak.date,
      note: `Wealth fell below nisab on ${firstBreak.date} and has not returned above it.`,
    };
  }

  const proposedAnniversary = addDays(restart.date, LUNAR_YEAR_DAYS);
  const elapsed = daysBetween(restart.date, anniversary);
  if (elapsed >= LUNAR_YEAR_DAYS) {
    return {
      ...common,
      complete: true,
      brokenOn: firstBreak.date,
      restartedOn: restart.date,
      proposedAnniversary,
      note: `Hawl broke on ${firstBreak.date}, restarted ${restart.date}, and a full lunar year has since passed. Move the anniversary to ${restart.date}.`,
    };
  }
  return {
    ...common,
    complete: false,
    brokenOn: firstBreak.date,
    restartedOn: restart.date,
    proposedAnniversary,
    note: `Hawl broke on ${firstBreak.date} and restarted ${restart.date}. Zakat falls due around ${proposedAnniversary}.`,
  };
}
