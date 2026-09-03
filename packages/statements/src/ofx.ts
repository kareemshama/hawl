import type { IsoDate, Transaction } from "@hawl/core-types";
import { round2 } from "./amounts.js";
import { parseDate } from "./dates.js";
import { hashString } from "./normalize.js";

export interface OfxResult {
  transactions: Transaction[];
  accountId?: string;
  accountType?: string;
  currency?: string;
  ledgerBalance?: number;
  ledgerDate?: IsoDate;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  warnings: string[];
}

/** Read the value of a tag in SGML (no closing tag) or XML form. */
function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1]!.trim() : undefined;
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>|OFXHEADER|<STMTTRN>/i.test(text.slice(0, 4000));
}

/**
 * Parse OFX 1.x (SGML) and 2.x (XML), including Quicken QFX. Only the pieces a zakat
 * calculation needs: transactions, ledger balance, statement period, account identity.
 */
export function parseOfx(text: string, opts: { accountId: string; file: string }): OfxResult {
  const warnings: string[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCTRANLIST>|<\/STMTTRN>\s*<\/BANKTRANLIST>|$)/gi) ?? [];
  const prefix = `${opts.accountId}-${hashString(opts.file)}`;
  const txns: Transaction[] = [];

  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, "DTPOSTED") ?? tag(b, "DTUSER"));
    const amount = Number(tag(b, "TRNAMT")?.replace(/,/g, ""));
    if (!date || !Number.isFinite(amount)) {
      warnings.push(`Transaction ${i + 1} skipped: missing date or amount.`);
      return;
    }
    const name = tag(b, "NAME") ?? "";
    const memo = tag(b, "MEMO") ?? "";
    const description = [name, memo].filter((s) => s && s !== name || s === name).filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || (tag(b, "TRNTYPE") ?? "Transaction");
    txns.push({
      id: tag(b, "FITID") ? `${prefix}-${tag(b, "FITID")}` : `${prefix}-${i}`,
      accountId: opts.accountId,
      date,
      amount: round2(amount),
      description,
      source: { file: opts.file, line: i + 1, confidence: "high" },
    });
  });

  txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const ledgerBalance = Number(tag(text, "BALAMT")?.replace(/,/g, ""));
  const ledgerDate = parseDate(tag(text, "DTASOF"));
  const periodStart = parseDate(tag(text, "DTSTART"));
  const periodEnd = parseDate(tag(text, "DTEND"));
  const currency = tag(text, "CURDEF");
  const acct = tag(text, "ACCTID");
  const acctType = tag(text, "ACCTTYPE");

  // Fill running balances backward from the ledger balance when it is dated at or after the last transaction.
  if (Number.isFinite(ledgerBalance) && txns.length > 0 && (!ledgerDate || ledgerDate >= txns[txns.length - 1]!.date)) {
    let bal = ledgerBalance;
    for (let i = txns.length - 1; i >= 0; i--) {
      txns[i]!.balanceAfter = round2(bal);
      bal = bal - txns[i]!.amount;
    }
  }

  if (txns.length === 0) warnings.push("No transactions found in the OFX file.");

  return {
    transactions: txns,
    warnings,
    ...(acct ? { accountId: acct } : {}),
    ...(acctType ? { accountType: acctType } : {}),
    ...(currency ? { currency } : {}),
    ...(Number.isFinite(ledgerBalance) ? { ledgerBalance: round2(ledgerBalance) } : {}),
    ...(ledgerDate ? { ledgerDate } : {}),
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
  };
}
