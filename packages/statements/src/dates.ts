import type { DateOrder, IsoDate } from "@hawl/core-types";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Parse a date string from a statement. `order` resolves ambiguous numeric dates like 03/04/2026.
 * Returns null when the string is not a date.
 */
export function parseDate(raw: string | undefined | null, order: DateOrder = "mdy"): IsoDate | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (s === "") return null;

  // ISO and OFX compact: 2026-01-05, 2026/01/05, 20260105[120000]
  let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})(\d{6})?(\[.*\])?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? iso(y, mo, d) : null;
  }

  // Numeric with separators: 01/05/2026, 5-1-26, 01.05.2026, QIF 1/05'2026
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-'](\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]));
    let mo: number;
    let d: number;
    if (order === "dmy") [d, mo] = [a, b];
    else [mo, d] = [a, b];
    // If the chosen order is impossible but the other is not, use the other.
    if (!valid(y, mo, d) && valid(y, d, mo)) [mo, d] = [d, mo];
    return valid(y, mo, d) ? iso(y, mo, d) : null;
  }

  // Textual months: 5 Jan 2026, 05-Jan-2026, Jan 5, 2026, January 5 2026, 5 January 2026
  m = /^(\d{1,2})[ \-\/]([A-Za-z]{3,9})\.?[ \-\/,]+(\d{2,4})$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]!.toLowerCase()];
    const y = expandYear(Number(m[3]));
    return mo && valid(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const d = Number(m[2]);
    const y = expandYear(Number(m[3]));
    return mo && valid(y, mo, d) ? iso(y, mo, d) : null;
  }
  return null;
}

/** True when a string is a date under any order. */
export function looksLikeDate(raw: string): boolean {
  return parseDate(raw, "mdy") !== null || parseDate(raw, "dmy") !== null;
}

/**
 * Infer day/month order from a sample of numeric dates. Returns null when every sample is
 * ambiguous (all components 12 or less), so the caller can fall back to a locale default.
 */
export function inferDateOrder(samples: string[]): DateOrder | null {
  let mdyPossible = true;
  let dmyPossible = true;
  let sawNumeric = false;
  for (const s of samples) {
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-'](\d{2,4})$/.exec(s.trim());
    if (!m) {
      if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(s.trim())) return "ymd";
      continue;
    }
    sawNumeric = true;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) mdyPossible = false;
    if (b > 12) dmyPossible = false;
  }
  if (!sawNumeric) return null;
  if (mdyPossible && !dmyPossible) return "mdy";
  if (dmyPossible && !mdyPossible) return "dmy";
  return null;
}

export function defaultDateOrder(currency: string): DateOrder {
  return currency.toUpperCase() === "USD" ? "mdy" : "dmy";
}
