import type { IsoDate } from "@hawl/core-types";

/** Round to cents. Uses a scaled epsilon so 1.005 rounds up. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const MS_PER_DAY = 86_400_000;

export function parseIsoDate(d: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid ISO date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return formatIsoDate(parseIsoDate(d) + days * MS_PER_DAY);
}

/** Whole days from a to b. Positive when b is after a. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(b) - parseIsoDate(a)) / MS_PER_DAY);
}

/** Convert karat to purity fraction (R4.2). */
export function karatToPurity(karat: number): number {
  return clamp01(karat / 24);
}
