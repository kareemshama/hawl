import test from "node:test";
import assert from "node:assert/strict";
import { parseOfx, parseQif, looksLikeOfx, looksLikeQif } from "../src/index.js";

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>021000021
<ACCTID>123456789
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260107120000[-5:EST]
<TRNAMT>-45.20
<FITID>2026010700001
<NAME>AMAZON MKTPL
<MEMO>ORDER 123
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260105
<TRNAMT>2500.00
<FITID>2026010500001
<NAME>PAYROLL ACME
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4954.80
<DTASOF>20260131
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

test("OFX SGML: transactions, ledger balance, period, and back-filled running balances", () => {
  assert.equal(looksLikeOfx(OFX_SGML), true);
  const r = parseOfx(OFX_SGML, { accountId: "a", file: "x.qfx" });
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0]!.date, "2026-01-05");
  assert.equal(r.transactions[0]!.amount, 2500);
  assert.equal(r.transactions[1]!.amount, -45.2);
  assert.equal(r.transactions[1]!.description, "AMAZON MKTPL ORDER 123");
  assert.equal(r.ledgerBalance, 4954.8);
  assert.equal(r.ledgerDate, "2026-01-31");
  assert.equal(r.periodStart, "2026-01-01");
  assert.equal(r.periodEnd, "2026-01-31");
  assert.equal(r.currency, "USD");
  assert.equal(r.accountType, "CHECKING");
  // Back-filled: last txn ends at ledger balance, previous is ledger minus last amount.
  assert.equal(r.transactions[1]!.balanceAfter, 4954.8);
  assert.equal(r.transactions[0]!.balanceAfter, 5000);
  assert.ok(r.transactions[0]!.id.endsWith("2026010500001"));
});

test("OFX XML form parses the same", () => {
  const xml = `<?xml version="1.0"?><OFX><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>20260210</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>1</FITID><NAME>COFFEE</NAME></STMTTRN></BANKTRANLIST></STMTRS></OFX>`;
  const r = parseOfx(xml, { accountId: "a", file: "x.ofx" });
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0]!.amount, -12.34);
  assert.equal(r.transactions[0]!.description, "COFFEE");
  assert.equal(r.transactions[0]!.balanceAfter, undefined);
});

const QIF = `!Type:Bank
D1/07'2026
T-45.20
PAMAZON MKTPL
MORDER 123
^
D1/05'2026
T2,500.00
PPAYROLL ACME
^
D01/03/2026
U-120.00
PCOSTCO
^
`;

test("QIF: dates with apostrophe years, T and U amounts, sorted ascending", () => {
  assert.equal(looksLikeQif(QIF), true);
  const r = parseQif(QIF, { accountId: "a", file: "x.qif", dateOrder: "mdy" });
  assert.equal(r.accountType, "Bank");
  assert.deepEqual(r.transactions.map((t) => t.date), ["2026-01-03", "2026-01-05", "2026-01-07"]);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-120, 2500, -45.2]);
  assert.equal(r.transactions[2]!.description, "AMAZON MKTPL ORDER 123");
});
