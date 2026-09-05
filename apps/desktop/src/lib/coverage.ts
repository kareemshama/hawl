/**
 * Which days the imported statements cover, per account, and where the gaps are.
 * Pure date arithmetic on ISO dates (YYYY-MM-DD); no time zones involved.
 */
import type { StatementAccount, StatementImport } from "@hawl/core-types";

export interface Interval {
  from: string;
  to: string;
}

const MS_DAY = 86_400_000;

function utc(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days from a to b inclusive; 0 when b is before a. */
export function daysInclusive(a: string, b: string): number {
  return Math.max(0, Math.round((utc(b) - utc(a)) / MS_DAY) + 1);
}

export function shiftDays(d: string, n: number): string {
  return iso(utc(d) + n * MS_DAY);
}

/** Sort and merge touching or overlapping intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.from && i.to && i.from <= i.to)
    .map((i) => ({ ...i }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.from <= shiftDays(last.to, 1)) {
      if (cur.to > last.to) last.to = cur.to;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/** The parts of [from, to] that no interval covers. */
export function uncovered(intervals: Interval[], from: string, to: string): Interval[] {
  if (from > to) return [];
  const gaps: Interval[] = [];
  let cursor = from;
  for (const i of mergeIntervals(intervals)) {
    if (i.to < cursor) continue;
    if (i.from > to) break;
    if (i.from > cursor) gaps.push({ from: cursor, to: shiftDays(i.from, -1) });
    const next = shiftDays(i.to, 1);
    if (next > cursor) cursor = next;
    if (cursor > to) break;
  }
  if (cursor <= to) gaps.push({ from: cursor, to });
  return gaps;
}

export interface MonthCell {
  /** YYYY-MM */
  key: string;
  label: string;
  days: number;
  coveredDays: number;
  state: "full" | "partial" | "none";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One cell per calendar month between from and to, with how much of it the intervals cover. */
export function monthCells(intervals: Interval[], from: string, to: string): MonthCell[] {
  if (from > to) return [];
  const merged = mergeIntervals(intervals);
  const cells: MonthCell[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const first = `${key}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${key}-${String(lastDay).padStart(2, "0")}`;
    if (first > to) break;
    const start = first < from ? from : first;
    const end = last > to ? to : last;
    const days = daysInclusive(start, end);
    let covered = 0;
    for (const i of merged) {
      const s = i.from > start ? i.from : start;
      const e = i.to < end ? i.to : end;
      covered += daysInclusive(s, e);
    }
    cells.push({ key, label: MONTHS[m - 1]!, days, coveredDays: covered, state: covered >= days ? "full" : covered > 0 ? "partial" : "none" });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return cells;
}

/** The periods this account's imports cover. Imports without a period are ignored. */
export function accountIntervals(account: StatementAccount, imports: StatementImport[]): Interval[] {
  return imports.filter((i) => i.accountId === account.id && i.periodStart && i.periodEnd).map((i) => ({ from: i.periodStart!, to: i.periodEnd! }));
}

/** Earliest start and latest end across all imports with a period. */
export function overallRange(imports: StatementImport[]): Interval | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const i of imports) {
    if (!i.periodStart || !i.periodEnd) continue;
    if (from === null || i.periodStart < from) from = i.periodStart;
    if (to === null || i.periodEnd > to) to = i.periodEnd;
  }
  return from && to ? { from, to } : null;
}

/** "2025-10-06 to 2025-11-03", or a single date when the gap is one day. */
export function formatInterval(i: Interval): string {
  return i.from === i.to ? i.from : `${i.from} to ${i.to}`;
}
