import type { ColumnMapping, Confidence, DateOrder } from "@hawl/core-types";
import { looksLikeAmount, parseAmount } from "./amounts.js";
import { inferDateOrder, looksLikeDate } from "./dates.js";
import type { Table } from "./table.js";

export interface MappingGuess {
  mapping: ColumnMapping | null;
  confidence: Confidence;
  reasons: string[];
}

const SYN = {
  date: [/^(transaction |trans |posting |posted |post |value |booking |book |effective |settlement )?date$/i, /^date (posted|of transaction)$/i, /^posted$/i, /^when$/i],
  description: [/^(transaction )?description$/i, /^memo$/i, /^details$/i, /^narrative$/i, /^payee$/i, /^name$/i, /^merchant$/i, /^particulars$/i, /^reference$/i, /^transaction$/i, /^notes?$/i, /^description of transaction$/i],
  amount: [/^amount$/i, /^(transaction |net |signed )?amount( \([a-z]{3}\))?$/i, /^value$/i, /^sum$/i, /^amount \(gbp\)$/i, /^amount \(usd\)$/i],
  debit: [/^debit(s| amount)?$/i, /^withdrawals?( amount)?$/i, /^money out$/i, /^paid out$/i, /^out$/i, /^payments?$/i, /^debit \(-\)$/i],
  credit: [/^credits?( amount)?$/i, /^deposits?( amount)?$/i, /^money in$/i, /^paid in$/i, /^in$/i, /^receipts?$/i, /^credit \(\+\)$/i],
  balance: [/^(running |ledger |closing |available |current |account )?balance( after( transaction)?)?$/i, /^running bal\.?$/i, /^bal\.?$/i, /^balance \([a-z]{3}\)$/i],
} as const;

function findHeader(headers: string[], patterns: readonly RegExp[]): number | undefined {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h.trim()));
    if (i !== -1) return i;
  }
  return undefined;
}

/** Fraction of non-empty cells in a column that satisfy `test`. */
function columnScore(rows: string[][], col: number, test: (s: string) => boolean): number {
  let seen = 0;
  let hit = 0;
  for (const r of rows.slice(0, 200)) {
    const c = r[col];
    if (c === undefined || c.trim() === "") continue;
    seen++;
    if (test(c)) hit++;
  }
  return seen === 0 ? 0 : hit / seen;
}

function nonEmptyCount(rows: string[][], col: number): number {
  return rows.reduce((n, r) => n + ((r[col] ?? "").trim() !== "" ? 1 : 0), 0);
}

/**
 * Guess which columns hold the date, description, amounts, and balance.
 * Uses header names first, then falls back to content analysis.
 */
export function detectMapping(table: Table, defaultOrder: DateOrder): MappingGuess {
  const reasons: string[] = [];
  const width = table.headers?.length ?? Math.max(0, ...table.rows.map((r) => r.length));
  if (width < 2 || table.rows.length === 0) {
    return { mapping: null, confidence: "low", reasons: ["Not enough columns or rows to map."] };
  }

  let date: number | undefined;
  let description: number | undefined;
  let amount: number | undefined;
  let debit: number | undefined;
  let credit: number | undefined;
  let balance: number | undefined;
  let confidence: Confidence = "low";

  if (table.headers) {
    const h = table.headers;
    date = findHeader(h, SYN.date);
    description = findHeader(h, SYN.description);
    amount = findHeader(h, SYN.amount);
    debit = findHeader(h, SYN.debit);
    credit = findHeader(h, SYN.credit);
    balance = findHeader(h, SYN.balance);
    if (date !== undefined && (amount !== undefined || (debit !== undefined && credit !== undefined))) {
      confidence = "high";
      reasons.push("Columns matched by header names.");
    } else {
      reasons.push("Headers did not fully match; checked cell contents.");
    }
  }

  // Content analysis fills gaps.
  const dateScores = Array.from({ length: width }, (_, c) => columnScore(table.rows, c, looksLikeDate));
  const amountScores = Array.from({ length: width }, (_, c) => columnScore(table.rows, c, looksLikeAmount));

  if (date === undefined) {
    const best = argmax(dateScores);
    if (best !== -1 && dateScores[best]! >= 0.8) {
      date = best;
      reasons.push(`Column ${best + 1} looks like dates.`);
    }
  }

  const numericCols = amountScores.map((s, c) => (s >= 0.8 && c !== date ? c : -1)).filter((c) => c !== -1);

  if (amount === undefined && debit === undefined && credit === undefined) {
    // Choose balance first: the numeric column whose values are all non-negative and whose
    // consecutive differences match another numeric column.
    if (balance === undefined && numericCols.length >= 2) {
      balance = pickBalanceColumn(table.rows, numericCols);
      if (balance !== undefined) reasons.push(`Column ${balance + 1} behaves like a running balance.`);
    }
    const remaining = numericCols.filter((c) => c !== balance);
    if (remaining.length === 1) {
      amount = remaining[0];
    } else if (remaining.length >= 2) {
      // Two unsigned columns that are rarely both filled on one row are debit and credit.
      const [a, b] = [remaining[0]!, remaining[1]!];
      const both = table.rows.filter((r) => (r[a] ?? "").trim() !== "" && (r[b] ?? "").trim() !== "").length;
      if (both / Math.max(1, table.rows.length) < 0.1) {
        // Debit is usually the left column, and outflows usually outnumber inflows.
        debit = nonEmptyCount(table.rows, a) >= nonEmptyCount(table.rows, b) ? a : b;
        credit = debit === a ? b : a;
        reasons.push("Two sparse numeric columns treated as debit and credit.");
      } else {
        amount = a;
      }
    }
  } else if (balance === undefined && numericCols.length > 0) {
    const others = numericCols.filter((c) => c !== amount && c !== debit && c !== credit);
    if (others.length >= 1) {
      balance = pickBalanceColumn(table.rows, [...others, ...(amount !== undefined ? [amount] : [])]) ?? others[others.length - 1];
      if (balance === amount) balance = undefined;
    }
  }

  if (description === undefined) {
    // The widest text column that is not a date or number.
    let best = -1;
    let bestLen = -1;
    for (let c = 0; c < width; c++) {
      if (c === date || c === amount || c === debit || c === credit || c === balance) continue;
      if (dateScores[c]! > 0.5 || amountScores[c]! > 0.5) continue;
      const avg = table.rows.reduce((s, r) => s + (r[c] ?? "").length, 0) / table.rows.length;
      if (avg > bestLen) {
        bestLen = avg;
        best = c;
      }
    }
    if (best !== -1) description = best;
  }

  if (date === undefined || description === undefined || (amount === undefined && (debit === undefined || credit === undefined))) {
    return { mapping: null, confidence: "low", reasons: [...reasons, "Could not find a date column and an amount column. Choose them by hand."] };
  }

  const dateOrder = inferDateOrder(table.rows.map((r) => r[date!] ?? "")) ?? defaultOrder;
  if (confidence !== "high") confidence = "medium";

  const mapping: ColumnMapping = {
    date,
    description,
    dateOrder,
    hasHeader: table.headers !== null,
    ...(amount !== undefined ? { amount } : {}),
    ...(debit !== undefined ? { debit } : {}),
    ...(credit !== undefined ? { credit } : {}),
    ...(balance !== undefined ? { balance } : {}),
  };
  return { mapping, confidence, reasons };
}

function argmax(xs: number[]): number {
  let best = -1;
  let bestV = -Infinity;
  xs.forEach((v, i) => {
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return best;
}

/**
 * Among numeric columns, find the one whose consecutive differences equal the values in some
 * other numeric column (a running balance). Returns undefined if none qualifies.
 */
function pickBalanceColumn(rows: string[][], cols: number[]): number | undefined {
  const sample = rows.slice(0, 60);
  let best: number | undefined;
  let bestHits = 0;
  for (const b of cols) {
    const bal = sample.map((r) => parseAmount(r[b] ?? ""));
    for (const a of cols) {
      if (a === b) continue;
      const amt = sample.map((r) => parseAmount(r[a] ?? ""));
      let hits = 0;
      let tries = 0;
      for (let i = 1; i < sample.length; i++) {
        const prev = bal[i - 1];
        const cur = bal[i];
        const x = amt[i];
        if (prev === null || cur === null || x === null || prev === undefined || cur === undefined || x === undefined) continue;
        tries++;
        const diff = Math.abs(Math.abs(cur - prev) - Math.abs(x));
        if (diff < 0.011) hits++;
      }
      if (tries >= 2 && hits / tries > 0.6 && hits > bestHits) {
        bestHits = hits;
        best = b;
      }
    }
  }
  return best;
}
