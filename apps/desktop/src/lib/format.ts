export function money(n: number, currency: string, opts: { signed?: boolean } = {}): string {
  const f = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 });
  const s = f.format(Math.abs(n));
  if (n < 0) return `-${s}`;
  return opts.signed && n > 0 ? `+${s}` : s;
}

export function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function grams(n: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)} g`;
}

export function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
