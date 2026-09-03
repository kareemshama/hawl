import type { Transaction } from "@hawl/core-types";

/**
 * Cross-file duplicate detection.
 *
 * The same transaction can carry a different description in a PDF than in a CSV (continuation
 * lines, truncation), so when a running balance exists the date, amount, and balance identify it.
 * Without a balance the full normalized description is part of the key.
 *
 * Only transactions already in the profile count as "existing": rows within one file are distinct
 * by construction, and each existing transaction can absorb at most one incoming duplicate, so a
 * same-day net-zero pair does not swallow an unrelated third row.
 */
export function transactionKeys(t: Transaction): string[] {
  const keys = [`${t.accountId}|${t.date}|${t.amount}|d:${t.description.toLowerCase().replace(/\s+/g, " ").trim()}`];
  if (t.balanceAfter !== undefined) keys.push(`${t.accountId}|${t.date}|${t.amount}|b:${t.balanceAfter}`);
  return keys;
}

export function dedupeIncoming(existing: Transaction[], incoming: Transaction[]): { fresh: Transaction[]; skipped: Transaction[] } {
  // Each existing transaction is a token that one incoming duplicate can consume.
  const tokens = new Map<string, Set<string>>(); // key -> ids of existing transactions holding it
  for (const e of existing) {
    for (const k of transactionKeys(e)) {
      const set = tokens.get(k) ?? new Set<string>();
      set.add(e.id);
      tokens.set(k, set);
    }
  }
  const consumed = new Set<string>();
  const fresh: Transaction[] = [];
  const skipped: Transaction[] = [];
  for (const t of incoming) {
    let match: string | undefined;
    for (const k of transactionKeys(t)) {
      const ids = tokens.get(k);
      if (!ids) continue;
      match = [...ids].find((id) => !consumed.has(id));
      if (match) break;
    }
    if (match) {
      consumed.add(match);
      skipped.push(t);
    } else {
      fresh.push(t);
    }
  }
  return { fresh, skipped };
}
