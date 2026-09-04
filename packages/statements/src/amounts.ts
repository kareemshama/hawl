/**
 * Parse a money string from a bank export into a signed number.
 * Handles: $1,234.56  -1,234.56  (1,234.56)  1.234,56  1 234,56  £45.20  45.20 CR  45.20-  −12.00
 * Returns null when the string is not a number.
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s === "" || /^-+$/.test(s)) return null;

  let negative = false;
  // Accounting negatives.
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Trailing CR/DR markers: CR is money in, DR is money out.
  const crdr = /\b(CR|DR|Cr|Dr)\.?$/.exec(s);
  if (crdr) {
    if (/^d/i.test(crdr[1]!)) negative = true;
    s = s.slice(0, crdr.index).trim();
  }
  // Trailing minus.
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  // Leading sign, including unicode minus and a plus. Any negative marker means negative;
  // markers never cancel each other ("-100.00-" and "(-100.00)" are both money out).
  s = s.replace(/^\s*[+]/, "");
  if (/^\s*[-−–]/.test(s)) {
    negative = true;
    s = s.replace(/^\s*[-−–]\s*/, "");
  }
  // Currency symbols, codes, and spaces.
  s = s.replace(/[A-Za-z$£€¥₹ \s']/g, "");
  if (s === "") return null;

  // Decide decimal separator.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // 1.234,56 style
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // Only commas: decimal if exactly one comma followed by 1-2 digits, else thousands.
    const after = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) ?? []).length;
    if (commaCount === 1 && (after === 1 || after === 2)) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
  }

  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** True when the string looks like money rather than a reference number or date. */
export function looksLikeAmount(raw: string): boolean {
  const s = raw.trim();
  if (s === "") return false;
  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(s)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  if (parseAmount(s) === null) return false;
  // Plain long digit strings are probably reference numbers.
  if (/^\d{7,}$/.test(s.replace(/[^\d]/g, "")) && !/[.,]\d{2}$/.test(s)) return false;
  return true;
}

/**
 * Stricter than looksLikeAmount: requires cents. PDF statements always print cents, and this
 * keeps "REF 88" or "INV 2026" in a description from being read as money.
 */
export function looksLikeMoney(raw: string): boolean {
  const s = raw.trim();
  return looksLikeAmount(s) && /\d[.,]\d{2}\)?(\s?(CR|DR|Cr|Dr)\.?)?-?$/.test(s);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
