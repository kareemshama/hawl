import type { ColumnMapping, Confidence, IsoDate, Transaction } from "@hawl/core-types";
import { parseAmount, round2 } from "./amounts.js";
import { parseDate } from "./dates.js";
import type { Table } from "./table.js";

export interface NormalizeResult {
  transactions: Transaction[];
  warnings: string[];
  /** True when every consecutive running balance agreed with the amounts. */
  balanceVerified: boolean;
  /** Rows that failed the running-balance check, by source line. */
  mismatches: number[];
  skipped: number;
}

export interface NormalizeOptions {
  accountId: string;
  file: string;
  idPrefix?: string;
  /** Page numbers per row for PDF sources. */
  pages?: number[];
  /** Balance before the first row, from a statement summary. Lets the first row's sign be verified. */
  openingBalance?: number;
}

/**
 * Turn a mapped table into signed transactions in ascending date order.
 * When a balance column exists, the sign of each amount is reconciled against the balance
 * movement, which fixes unsigned debit/credit exports and inverted sign conventions.
 */
export function tableToTransactions(table: Table, mapping: ColumnMapping, opts: NormalizeOptions): NormalizeResult {
  const warnings: string[] = [];
  const raw: { date: IsoDate; amount: number; description: string; balance: number | null; line: number; page?: number; index: number }[] = [];
  let skipped = 0;

  table.rows.forEach((r, i) => {
    const date = parseDate(r[mapping.date], mapping.dateOrder);
    if (!date) {
      skipped++;
      return;
    }
    let amount: number | null = null;
    if (mapping.amount !== undefined) {
      amount = parseAmount(r[mapping.amount]);
    } else if (mapping.debit !== undefined && mapping.credit !== undefined) {
      const d = parseAmount(r[mapping.debit]);
      const c = parseAmount(r[mapping.credit]);
      if (d === null && c === null) amount = null;
      else amount = round2((c ?? 0) === 0 ? -Math.abs(d ?? 0) : Math.abs(c ?? 0) - Math.abs(d ?? 0));
    }
    if (amount === null) {
      skipped++;
      return;
    }
    const balance = mapping.balance !== undefined ? parseAmount(r[mapping.balance]) : null;
    const description = (r[mapping.description] ?? "").replace(/\s+/g, " ").trim();
    const page = opts.pages?.[i];
    raw.push({ date, amount, description, balance, line: table.lineNumbers[i] ?? i + 1, index: i, ...(page !== undefined ? { page } : {}) });
  });

  if (raw.length === 0) {
    return { transactions: [], warnings: ["No rows with both a date and an amount."], balanceVerified: false, mismatches: [], skipped };
  }

  // Statements are often newest-first. Detect by comparing first and last dates and reverse,
  // keeping the original order for same-day rows so the balance chain stays intact.
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  const descending = first.date > last.date;
  const ordered = descending ? [...raw].reverse() : raw;
  if (descending) warnings.push("Rows were newest-first and have been reordered.");

  // Reconcile signs and verify balances.
  const mismatches: number[] = [];
  let checked = 0;
  let hasBalances = false;
  const head = ordered[0]!;
  if (head.balance !== null) {
    hasBalances = true;
    if (opts.openingBalance !== undefined) {
      checked++;
      const delta = round2(head.balance - opts.openingBalance);
      if (Math.abs(Math.abs(delta) - Math.abs(head.amount)) < 0.011) {
        if (Math.sign(delta) !== Math.sign(head.amount) && delta !== 0) head.amount = delta;
      } else {
        mismatches.push(head.line);
      }
    } else if (mapping.amount !== undefined && ordered.every((r) => r.amount >= 0) && ordered.length > 1) {
      warnings.push("The amount column is unsigned and no opening balance was given, so the first row's direction could not be verified.");
    }
  }
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    if (prev.balance === null || cur.balance === null) continue;
    hasBalances = true;
    checked++;
    const delta = round2(cur.balance - prev.balance);
    if (Math.abs(Math.abs(delta) - Math.abs(cur.amount)) < 0.011) {
      if (Math.sign(delta) !== Math.sign(cur.amount) && delta !== 0) cur.amount = delta;
    } else {
      mismatches.push(cur.line);
    }
  }
  const balanceVerified = hasBalances && checked > 0 && mismatches.length === 0;
  if (hasBalances && mismatches.length > 0) {
    warnings.push(`${mismatches.length} of ${checked} running-balance checks failed. Those rows are marked low confidence.`);
  }
  if (!hasBalances) warnings.push("No running balance column, so amounts could not be cross-checked.");

  const confidence: Confidence = balanceVerified ? "high" : hasBalances ? "medium" : "medium";
  const prefix = opts.idPrefix ?? `${opts.accountId}-${hashString(opts.file)}`;
  const transactions: Transaction[] = ordered.map((r, i) => ({
    id: `${prefix}-${i}`,
    accountId: opts.accountId,
    date: r.date,
    amount: round2(r.amount),
    description: r.description,
    ...(r.balance !== null ? { balanceAfter: round2(r.balance) } : {}),
    source: {
      file: opts.file,
      line: r.line,
      ...(r.page !== undefined ? { page: r.page } : {}),
      confidence: mismatches.includes(r.line) ? "low" : confidence,
    },
  }));

  return { transactions, warnings, balanceVerified, mismatches, skipped };
}

export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
