import type { DailyBalance, IsoDate, StatementAccount, StatementImport, Transaction } from "@hawl/core-types";
import { round2 } from "./amounts.js";

const MS_PER_DAY = 86_400_000;

function toMs(d: IsoDate): number {
  return Date.parse(`${d}T00:00:00Z`);
}
function toIso(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(d: IsoDate, n: number): IsoDate {
  return toIso(toMs(d) + n * MS_PER_DAY);
}

export interface BalancePoint {
  date: IsoDate;
  balance: number;
}

export interface AccountCoverage {
  accountId: string;
  from: IsoDate | null;
  to: IsoDate | null;
  points: number;
  /** True when the account's balance history is anchored (running balances or an import balance). */
  anchored: boolean;
}

export interface SeriesResult {
  series: DailyBalance[];
  perAccount: Record<string, DailyBalance[]>;
  coverage: AccountCoverage[];
  warnings: string[];
}

/** Account kinds that count as cash for the hawl balance series (R4.1). */
export function isCashAccount(a: StatementAccount): boolean {
  return a.kind === "checking" || a.kind === "savings" || a.kind === "other";
}

/**
 * Known balance points for one account, in date order. Uses running balances from the
 * statements when present; otherwise reconstructs them from an import's opening or closing
 * balance. Returns an empty list when the account has no anchor at all.
 */
export function accountBalancePoints(account: StatementAccount, transactions: Transaction[], imports: StatementImport[]): { points: BalancePoint[]; anchored: boolean } {
  const txns = transactions.filter((t) => t.accountId === account.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const withBal = txns.filter((t) => t.balanceAfter !== undefined);
  if (withBal.length > 0) {
    // Last balance of each day wins.
    const byDay = new Map<IsoDate, number>();
    for (const t of withBal) byDay.set(t.date, t.balanceAfter!);
    const points = [...byDay.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => (a.date < b.date ? -1 : 1));
    return { points, anchored: true };
  }
  // Anchor on an import balance.
  const imps = imports.filter((i) => i.accountId === account.id && (i.openingBalance !== undefined || i.closingBalance !== undefined));
  const anchor = imps.find((i) => i.closingBalance !== undefined && i.periodEnd) ?? imps.find((i) => i.openingBalance !== undefined && i.periodStart);
  if (!anchor) return { points: [], anchored: false };

  const points: BalancePoint[] = [];
  if (anchor.closingBalance !== undefined && anchor.periodEnd) {
    // Walk backward from the closing balance.
    let bal = anchor.closingBalance;
    const days = new Map<IsoDate, number>();
    days.set(anchor.periodEnd, bal);
    for (let i = txns.length - 1; i >= 0; i--) {
      const t = txns[i]!;
      if (t.date > anchor.periodEnd) continue;
      bal = round2(bal - t.amount);
      const prevDay = addDays(t.date, -1);
      if (!days.has(prevDay) || t.date <= anchor.periodEnd) days.set(prevDay, bal);
    }
    for (const [date, balance] of days) points.push({ date, balance });
  } else if (anchor.openingBalance !== undefined && anchor.periodStart) {
    let bal = anchor.openingBalance;
    points.push({ date: addDays(anchor.periodStart, -1), balance: bal });
    for (const t of txns) {
      if (t.date < anchor.periodStart) continue;
      bal = round2(bal + t.amount);
      points.push({ date: t.date, balance: bal });
    }
  }
  // Collapse to last point per day.
  const byDay = new Map<IsoDate, number>();
  for (const p of points.sort((a, b) => (a.date < b.date ? -1 : 1))) byDay.set(p.date, p.balance);
  return { points: [...byDay.entries()].map(([date, balance]) => ({ date, balance })), anchored: true };
}

/** Balance of one account on a date, carrying the last known balance forward. Null before the first point. */
export function balanceOn(points: BalancePoint[], date: IsoDate): number | null {
  let val: number | null = null;
  for (const p of points) {
    if (p.date <= date) val = p.balance;
    else break;
  }
  return val;
}

/**
 * Build the daily total cash balance across all cash accounts for [from, to].
 * Days before an account's first known balance contribute nothing for that account, and the
 * coverage report says so, so the hawl check can flag the gap (R15.1, R15.2).
 */
export function buildBalanceSeries(args: { accounts: StatementAccount[]; transactions: Transaction[]; imports: StatementImport[]; from: IsoDate; to: IsoDate }): SeriesResult {
  const warnings: string[] = [];
  const cashAccounts = args.accounts.filter(isCashAccount);
  const perAccount: Record<string, DailyBalance[]> = {};
  const coverage: AccountCoverage[] = [];
  const pointsBy = new Map<string, BalancePoint[]>();

  for (const a of cashAccounts) {
    const { points, anchored } = accountBalancePoints(a, args.transactions, args.imports);
    pointsBy.set(a.id, points);
    coverage.push({ accountId: a.id, from: points[0]?.date ?? null, to: points[points.length - 1]?.date ?? null, points: points.length, anchored });
    if (!anchored && args.transactions.some((t) => t.accountId === a.id)) {
      warnings.push(`${a.name}: transactions have no running balance and no statement balance to anchor them, so this account is left out of the daily series.`);
    }
  }

  const series: DailyBalance[] = [];
  const fromMs = toMs(args.from);
  const toMsV = toMs(args.to);
  if (!(fromMs <= toMsV)) return { series, perAccount, coverage, warnings: [...warnings, "Empty date range."] };

  for (let ms = fromMs; ms <= toMsV; ms += MS_PER_DAY) {
    const date = toIso(ms);
    let total = 0;
    let any = false;
    for (const a of cashAccounts) {
      const share = a.ownershipShare === undefined ? 1 : Math.min(1, Math.max(0, a.ownershipShare));
      const b = balanceOn(pointsBy.get(a.id) ?? [], date);
      if (b !== null) {
        any = true;
        const v = round2(b * share);
        total += v;
        (perAccount[a.id] ??= []).push({ date, total: v });
      }
    }
    if (any) series.push({ date, total: round2(total) });
  }

  const missingStart = coverage.filter((c) => c.anchored && c.from !== null && c.from > args.from);
  for (const c of missingStart) {
    const name = cashAccounts.find((a) => a.id === c.accountId)?.name ?? c.accountId;
    warnings.push(`${name}: history starts ${c.from}, after the hawl began on ${args.from}. Earlier days assume this account held nothing.`);
  }
  return { series, perAccount, coverage, warnings };
}

/** Lowest total and where it happened. */
export function lowestPoint(series: DailyBalance[]): DailyBalance | null {
  let low: DailyBalance | null = null;
  for (const d of series) if (!low || d.total < low.total) low = d;
  return low;
}
