import type { Asset, IsoDate, StatementAccount, StatementImport, Transaction } from "@hawl/core-types";
import { round2 } from "./amounts.js";
import { accountBalancePoints, accountFactor, balanceOn, isCashAccount } from "./series.js";

/** Id prefix for cash assets derived from statement accounts. */
export const DERIVED_PREFIX = "stmt-";

/**
 * Cash assets taken from statement accounts on a given date, converted to the base currency
 * (R4.1, R15.1, R15.4). The ownership share is carried on the asset so the engine cites R6.3.
 * Accounts with no balance known on or before the date are reported in `missing`; accounts in
 * another currency with no rate are reported in `unconverted` and left out.
 */
export function deriveCashAssets(args: { accounts: StatementAccount[]; transactions: Transaction[]; imports: StatementImport[]; date: IsoDate; baseCurrency?: string }): { assets: Asset[]; missing: StatementAccount[]; unconverted: StatementAccount[] } {
  const assets: Asset[] = [];
  const missing: StatementAccount[] = [];
  const unconverted: StatementAccount[] = [];
  for (const a of args.accounts) {
    if (!isCashAccount(a)) continue;
    const { converted } = accountFactor(a, args.baseCurrency);
    if (!converted) {
      unconverted.push(a);
      continue;
    }
    const { points } = accountBalancePoints(a, args.transactions, args.imports);
    const bal = balanceOn(points, args.date);
    if (bal === null) {
      missing.push(a);
      continue;
    }
    const foreign = args.baseCurrency && a.currency && a.currency.toUpperCase() !== args.baseCurrency.toUpperCase();
    const rate = foreign ? a.fxRateToBase ?? 1 : 1;
    const lastPoint = [...points].reverse().find((p) => p.date <= args.date);
    const file = args.imports.find((i) => i.accountId === a.id)?.file ?? "statements";
    assets.push({
      kind: "cash",
      id: `${DERIVED_PREFIX}${a.id}`,
      label: a.name,
      amount: round2(Math.max(0, bal) * rate),
      ...(a.ownershipShare !== undefined ? { ownershipShare: a.ownershipShare } : {}),
      source: {
        file,
        note: foreign
          ? `Balance ${round2(Math.max(0, bal))} ${a.currency} on ${lastPoint?.date ?? args.date} from statements, at ${rate} ${args.baseCurrency} per ${a.currency}`
          : `Balance on ${lastPoint?.date ?? args.date} from statements`,
      },
    });
  }
  return { assets, missing, unconverted };
}
