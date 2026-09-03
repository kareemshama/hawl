import type { IsoDate, MetalPrices } from "@hawl/core-types";

/** Round to cents. Uses a scaled epsilon so 1.005 rounds up. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Format a fraction as a percent string with one decimal, e.g. 0.9167 -> "91.7". */
export function pct(fraction: number): string {
  return String(Math.round(clamp01(fraction) * 1000) / 10);
}

const MS_PER_DAY = 86_400_000;

export function parseIsoDate(d: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid ISO date: ${d}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${d}`);
  }
  return ms;
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

/** Price per gram for a metal, or throw. Never let a missing price become 0 or NaN silently (R1.4). */
export function metalPrice(prices: MetalPrices, metal: "gold" | "silver"): number {
  const p = metal === "gold" ? prices.goldPerGram : prices.silverPerGram;
  if (!(Number.isFinite(p) && p > 0)) {
    throw new RangeError(`Missing or invalid ${metal} price per gram: ${String(p)}`);
  }
  return p;
}

export function assertFinite(n: number, what: string): number {
  if (!Number.isFinite(n)) throw new RangeError(`${what} is not a finite number: ${String(n)}`);
  return n;
}

/** Compile-time exhaustiveness guard. */
export function assertNever(x: never, what: string): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(x)}`);
}
