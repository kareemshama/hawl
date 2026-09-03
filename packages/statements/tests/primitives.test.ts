import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, looksLikeAmount, parseDate, inferDateOrder, sniffDelimiter, detectFormat } from "../src/index.js";

test("parseAmount handles the common bank formats", () => {
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("$1,234.56"), 1234.56);
  assert.equal(parseAmount("-1,234.56"), -1234.56);
  assert.equal(parseAmount("(1,234.56)"), -1234.56);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1 234,56"), 1234.56);
  assert.equal(parseAmount("£45.20"), 45.2);
  assert.equal(parseAmount("45.20 CR"), 45.2);
  assert.equal(parseAmount("45.20 DR"), -45.2);
  assert.equal(parseAmount("45.20-"), -45.2);
  assert.equal(parseAmount("−12.00"), -12);
  assert.equal(parseAmount("+12.00"), 12);
  assert.equal(parseAmount("1234"), 1234);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("N/A"), null);
  assert.equal(parseAmount("01/05/2026"), null);
});

test("looksLikeAmount rejects dates and reference numbers", () => {
  assert.equal(looksLikeAmount("1,234.56"), true);
  assert.equal(looksLikeAmount("01/05/2026"), false);
  assert.equal(looksLikeAmount("2026-01-05"), false);
  assert.equal(looksLikeAmount("123456789012"), false);
  assert.equal(looksLikeAmount("DEBIT"), false);
});

test("parseDate handles ISO, compact OFX, numeric orders, and textual months", () => {
  assert.equal(parseDate("2026-01-05"), "2026-01-05");
  assert.equal(parseDate("2026/01/05"), "2026-01-05");
  assert.equal(parseDate("20260105120000[-5:EST]"), "2026-01-05");
  assert.equal(parseDate("01/05/2026", "mdy"), "2026-01-05");
  assert.equal(parseDate("05/01/2026", "dmy"), "2026-01-05");
  assert.equal(parseDate("1/5/26", "mdy"), "2026-01-05");
  assert.equal(parseDate("1/05'2026", "mdy"), "2026-01-05");
  assert.equal(parseDate("05 Jan 2026"), "2026-01-05");
  assert.equal(parseDate("05-Jan-2026"), "2026-01-05");
  assert.equal(parseDate("Jan 5, 2026"), "2026-01-05");
  assert.equal(parseDate("January 5 2026"), "2026-01-05");
  // Impossible under the requested order falls back to the other order.
  assert.equal(parseDate("25/01/2026", "mdy"), "2026-01-25");
  assert.equal(parseDate("hello"), null);
  assert.equal(parseDate("2026-02-30"), null);
});

test("inferDateOrder resolves from unambiguous samples", () => {
  assert.equal(inferDateOrder(["01/05/2026", "01/25/2026"]), "mdy");
  assert.equal(inferDateOrder(["05/01/2026", "25/01/2026"]), "dmy");
  assert.equal(inferDateOrder(["01/05/2026", "02/03/2026"]), null);
  assert.equal(inferDateOrder(["2026-01-05"]), "ymd");
});

test("sniffDelimiter picks the consistent separator", () => {
  assert.equal(sniffDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(sniffDelimiter("a;b;c\n1;2;3\n"), ";");
  assert.equal(sniffDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
  assert.equal(sniffDelimiter('a,b,c\n"x, y",2,3\n'), ",");
});

test("detectFormat uses extension then content", () => {
  assert.equal(detectFormat("chase.CSV", "Date,Amount"), "csv");
  assert.equal(detectFormat("export.qfx", ""), "ofx");
  assert.equal(detectFormat("data.txt", "OFXHEADER:100\n<OFX>"), "ofx");
  assert.equal(detectFormat("data", "!Type:Bank\nD1/5/26"), "qif");
  assert.equal(detectFormat("statement.pdf", "%PDF-1.7"), "pdf");
  assert.equal(detectFormat("notes.doc", "hello"), null);
});
