import type { DateOrder, Transaction } from "@hawl/core-types";
import { parseAmount, round2 } from "./amounts.js";
import { parseDate } from "./dates.js";
import { hashString } from "./normalize.js";

export interface QifResult {
  transactions: Transaction[];
  accountType?: string;
  warnings: string[];
}

export function looksLikeQif(text: string): boolean {
  return /^!Type:|^!Account/im.test(text.slice(0, 2000));
}

/** Parse Quicken Interchange Format. Records are line-tagged and end with ^. */
export function parseQif(text: string, opts: { accountId: string; file: string; dateOrder: DateOrder }): QifResult {
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const prefix = `${opts.accountId}-${hashString(opts.file)}`;
  const txns: Transaction[] = [];
  let accountType: string | undefined;
  let cur: { date?: string; amount?: number; payee?: string; memo?: string; line: number } | null = null;
  let n = 0;

  const flush = () => {
    if (!cur) return;
    const date = parseDate(cur.date, opts.dateOrder);
    if (date && cur.amount !== undefined) {
      txns.push({
        id: `${prefix}-${n++}`,
        accountId: opts.accountId,
        date,
        amount: round2(cur.amount),
        description: [cur.payee, cur.memo].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "Transaction",
        source: { file: opts.file, line: cur.line, confidence: "medium" },
      });
    } else if (cur.date || cur.amount !== undefined) {
      warnings.push(`Record at line ${cur.line} skipped: missing date or amount.`);
    }
    cur = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (line === "") return;
    const code = line[0]!;
    const value = line.slice(1).trim();
    if (code === "!") {
      const m = /^!Type:(.+)$/i.exec(line);
      if (m) accountType = m[1]!.trim();
      return;
    }
    if (code === "^") {
      flush();
      return;
    }
    if (!cur) cur = { line: idx + 1 };
    switch (code) {
      case "D":
        cur.date = value.replace(/\s/g, "");
        break;
      case "T":
      case "U": {
        const a = parseAmount(value);
        if (a !== null) cur.amount = a;
        break;
      }
      case "P":
        cur.payee = value;
        break;
      case "M":
        cur.memo = value;
        break;
      default:
        break;
    }
  });
  flush();

  txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (txns.length === 0) warnings.push("No transactions found in the QIF file.");
  return { transactions: txns, warnings, ...(accountType ? { accountType } : {}) };
}
