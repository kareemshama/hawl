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
  /** False when the account is in another currency and no rate to the base currency is set. */
  converted: boolean;
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
 * Multiplier that turns an account's balance into the base currency, times the payer's share
 * (R4.1, R6.3, R15.4). Returns null when the account is in another currency with no rate.
 */
export function accountFactor(a: StatementAccount, baseCurrency?: string): { factor: number; converted: boolean } {
  const share = a.ownershipShare === undefined ? 1 : Math.min(1, Math.max(0, a.ownershipShare));
  if (baseCurrency && a.currency && a.currency.toUpperCase() !== baseCurrency.toUpperCase()) {
    if (a.fxRateToBase === undefined || !(a.fxRateToBase > 0)) return { factor: 0, converted: false };
    return { factor: share * a.fxRateToBase, converted: true };
  }
  return { factor: share, converted: true };
}

/**
 * Known balance points for one account, in date order, in the account's own currency.
 * Uses running balances from the statements when present. Otherwise the most recent statement
 * closing balance anchors the chain: transactions before it are walked backward, transactions
 * after it forward. With no closing balance, the earliest opening balance is walked forward.
 * Returns an empty list when the account has no anchor at all.
 */
export function accountBalancePoints(account: StatementAccount, transactions: Transaction[], imports: StatementImport[]): { points: BalancePoint[]; anchored: boolean } {
  const txns = transactions.filter((t) => t.accountId === account.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const withBal = txns.filter((t) => t.balanceAfter !== undefined);
  if (withBal.length > 0) {
    const byDay = new Map<IsoDate, number>();
    for (const t of withBal) byDay.set(t.date, t.balanceAfter!);
    const points = [...byDay.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => (a.date < b.date ? -1 : 1));
    return { points, anchored: true };
  }

  // Every statement summary is an anchor: its closing balance on the period end, its opening
  // balance on the day before the period start. Transactions are walked forward between
  // consecutive anchors and backward before the first one. Where a walk disagrees with the next
  // anchor, the anchor wins, since a printed statement balance beats an inferred one.
  const anchorMap = new Map<IsoDate, number>();
  for (const i of imports.filter((x) => x.accountId === account.id)) {
    if (i.openingBalance !== undefined && i.periodStart) anchorMap.set(addDays(i.periodStart, -1), i.openingBalance);
    if (i.closingBalance !== undefined && i.periodEnd) anchorMap.set(i.periodEnd, i.closingBalance);
  }
  if (anchorMap.size === 0) return { points: [], anchored: false };
  const anchors = [...anchorMap.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const days = new Map<IsoDate, number>(anchorMap);

  // Backward from the first anchor.
  const first = anchors[0]!;
  let bal = first.balance;
  const before = txns.filter((t) => t.date <= first.date);
  for (let i = before.length - 1; i >= 0; i--) {
    const t = before[i]!;
    bal = round2(bal - t.amount);
    const d = addDays(t.date, -1);
    if (!anchorMap.has(d)) days.set(d, bal);
  }
  // Forward from each anchor up to the next.
  anchors.forEach((a, idx) => {
    const next = anchors[idx + 1];
    let running = a.balance;
    for (const t of txns) {
      if (t.date <= a.date) continue;
      if (next && t.date > next.date) break;
      running = round2(running + t.amount);
      if (!anchorMap.has(t.date)) days.set(t.date, running);
    }
  });

  const points = [...days.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { points, anchored: true };
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
 * Build the daily total cash balance in the base currency across all cash accounts for
 * [from, to]. Days before an account's first known balance contribute nothing for that account,
 * and the coverage report says so, so the hawl check can flag the gap (R15.1, R15.2). Accounts in
 * another currency without a rate are left out with a warning rather than added at face value.
 */
export function buildBalanceSeries(args: { accounts: StatementAccount[]; transactions: Transaction[]; imports: StatementImport[]; from: IsoDate; to: IsoDate; baseCurrency?: string }): SeriesResult {
  const warnings: string[] = [];
  const cashAccounts = args.accounts.filter(isCashAccount);
  const perAccount: Record<string, DailyBalance[]> = {};
  const coverage: AccountCoverage[] = [];
  const pointsBy = new Map<string, BalancePoint[]>();
  const factorBy = new Map<string, number>();

  for (const a of cashAccounts) {
    const { factor, converted } = accountFactor(a, args.baseCurrency);
    const { points, anchored } = accountBalancePoints(a, args.transactions, args.imports);
    const usable = converted ? points : [];
    pointsBy.set(a.id, usable);
    factorBy.set(a.id, factor);
    coverage.push({ accountId: a.id, from: usable[0]?.date ?? null, to: usable[usable.length - 1]?.date ?? null, points: usable.length, anchored, converted });
    if (!converted) {
      warnings.push(`${a.name} is in ${a.currency} and has no exchange rate to ${args.baseCurrency}. Set one on the Statements screen; until then it is left out.`);
    } else if (!anchored && args.transactions.some((t) => t.accountId === a.id)) {
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
      const b = balanceOn(pointsBy.get(a.id) ?? [], date);
      if (b !== null) {
        any = true;
        const v = round2(b * (factorBy.get(a.id) ?? 1));
        total += v;
        (perAccount[a.id] ??= []).push({ date, total: v });
      }
    }
    if (any) series.push({ date, total: round2(total) });
  }

  const missingStart = coverage.filter((c) => c.anchored && c.converted && c.from !== null && c.from > args.from);
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
