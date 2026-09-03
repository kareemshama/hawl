/** A parsed grid of cells. Header row, if any, is separated out. */
export interface Table {
  headers: string[] | null;
  rows: string[][];
  /** 1-based line or row number in the source for each row, for provenance. */
  lineNumbers: number[];
  delimiter?: string;
}

const HEADER_WORDS = /date|description|memo|amount|balance|debit|credit|payee|details|narrative|withdraw|deposit|paid|money|type|reference|category|posted/i;

/** Sniff the delimiter from the first few non-empty lines. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 10);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((c) => c > 0);
    // Preamble lines (bank name, account number) have no delimiter; ignore them, but the
    // delimiter must appear on at least half the lines.
    if (counts.length === 0 || counts.length < lines.length / 2) continue;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const score = counts.length * 10 + min * 5 - (max - min);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === d) n++;
  }
  return n;
}

/** RFC 4180 style CSV parser with a sniffed delimiter. Skips blank lines and preamble junk. */
export function parseCsvText(text: string): Table {
  const delimiter = sniffDelimiter(text);
  const records: string[][] = [];
  const lineNumbers: number[] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  let line = 1;
  let rowStartLine = 1;
  const src = text.replace(/^﻿/, "");

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.some((c) => c.trim() !== "")) {
      records.push(row.map((c) => c.trim()));
      lineNumbers.push(rowStartLine);
    }
    row = [];
    rowStartLine = line;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === delimiter) pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      pushField();
      line++;
      pushRow();
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    pushField();
    pushRow();
  }

  // Drop preamble lines (bank name, account number) that have far fewer cells than the body.
  const widths = records.map((r) => r.length);
  const modeWidth = mode(widths);
  let start = 0;
  while (start < records.length && records[start]!.length < Math.max(2, modeWidth - 1)) start++;
  const body = records.slice(start);
  const bodyLines = lineNumbers.slice(start);

  // Header detection: first body row has header-like words and no amount/date cells.
  let headers: string[] | null = null;
  let rows = body;
  let rowLines = bodyLines;
  const first = body[0];
  if (first && first.some((c) => HEADER_WORDS.test(c)) && !first.some((c) => /^\s*[-$(]?\d[\d,]*\.\d{2}\)?\s*$/.test(c))) {
    headers = first;
    rows = body.slice(1);
    rowLines = bodyLines.slice(1);
  }
  // Normalize ragged rows to the header width.
  const width = headers ? headers.length : modeWidth;
  rows = rows.map((r) => {
    if (r.length === width) return r;
    if (r.length > width) return r.slice(0, width);
    return [...r, ...Array(width - r.length).fill("")];
  });
  return { headers, rows, lineNumbers: rowLines, delimiter };
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  let best = 0;
  let bestN = -1;
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c > bestN || (c === bestN && n > best)) {
      bestN = c;
      best = n;
    }
  }
  return best;
}
