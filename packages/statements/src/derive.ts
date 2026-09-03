import type { Asset, IsoDate, StatementAccount, StatementImport, Transaction } from "@hawl/core-types";
import { accountBalancePoints, balanceOn, isCashAccount } from "./series.js";

/** Id prefix for cash assets derived from statement accounts. */
export const DERIVED_PREFIX = "stmt-";

/**
 * Cash assets taken from statement accounts on a given date (R4.1, R15.1).
 * Accounts with no balance known on or before the date are skipped; the caller can report them.
 */
export function deriveCashAssets(args: { accounts: StatementAccount[]; transactions: Transaction[]; imports: StatementImport[]; date: IsoDate }): { assets: Asset[]; missing: StatementAccount[] } {
  const assets: Asset[] = [];
  const missing: StatementAccount[] = [];
  for (const a of args.accounts) {
    if (!isCashAccount(a)) continue;
    const { points } = accountBalancePoints(a, args.transactions, args.imports);
    const bal = balanceOn(points, args.date);
    if (bal === null) {
      missing.push(a);
      continue;
    }
    const lastPoint = [...points].reverse().find((p) => p.date <= args.date);
    const file = args.imports.find((i) => i.accountId === a.id)?.file ?? "statements";
    assets.push({
      kind: "cash",
      id: `${DERIVED_PREFIX}${a.id}`,
      label: a.name,
      amount: Math.max(0, bal),
      ...(a.ownershipShare !== undefined ? { ownershipShare: a.ownershipShare } : {}),
      source: { file, note: `Balance on ${lastPoint?.date ?? args.date} from statements` },
    });
  }
  return { assets, missing };
}
