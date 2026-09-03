import test from "node:test";
import assert from "node:assert/strict";
import type { Asset, Settings } from "@hawl/core-types";
import { valueAsset, resolveSettings, karatToPurity } from "../src/index.js";
import { PRICES } from "./fixtures.js";

function value(asset: Asset, settings: Settings = resolveSettings("hanafi")) {
  const warnings: string[] = [];
  const trace = valueAsset(asset, { settings, prices: PRICES, warnings });
  return { trace, warnings };
}

test("R4.1 cash is fully zakatable", () => {
  const { trace } = value({ kind: "cash", id: "c", label: "Checking", amount: 1234.56 });
  assert.equal(trace.zakatable, 1234.56);
  assert.deepEqual(trace.rules, ["R4.1"]);
});

test("R4.2 gold bullion is weight x purity x spot", () => {
  const { trace } = value({ kind: "metal", id: "g", label: "Coins", metal: "gold", grams: 50, purity: 1, usage: "bullion" });
  assert.equal(trace.zakatable, 5000);
  assert.deepEqual(trace.rules, ["R4.2"]);
});

test("R4.2 purity discounts 18k gold to 75 percent", () => {
  const { trace } = value({ kind: "metal", id: "g", label: "18k", metal: "gold", grams: 40, purity: karatToPurity(18), usage: "investment-jewellery" });
  assert.equal(trace.zakatable, 3000);
});

test("R4.3 personal jewellery is zakatable under Hanafi", () => {
  const { trace } = value({ kind: "metal", id: "j", label: "Necklace", metal: "gold", grams: 20, purity: 1, usage: "personal-jewellery" }, resolveSettings("hanafi"));
  assert.equal(trace.zakatable, 2000);
  assert.ok(trace.rules.includes("R4.3"));
});

test("R4.3 personal jewellery is exempt under Shafii, Maliki, Hanbali", () => {
  for (const m of ["shafii", "maliki", "hanbali"] as const) {
    const { trace } = value({ kind: "metal", id: "j", label: "Necklace", metal: "gold", grams: 20, purity: 1, usage: "personal-jewellery" }, resolveSettings(m));
    assert.equal(trace.zakatable, 0, m);
    assert.equal(trace.input, 2000, m);
  }
});

test("R4.3 investment jewellery is zakatable even where personal use is exempt", () => {
  const { trace } = value({ kind: "metal", id: "j", label: "Hoard", metal: "gold", grams: 20, purity: 1, usage: "investment-jewellery" }, resolveSettings("shafii"));
  assert.equal(trace.zakatable, 2000);
});

test("R4.4 trade goods at market value", () => {
  const { trace } = value({ kind: "trade-goods", id: "t", label: "Stock room", marketValue: 8000 });
  assert.equal(trace.zakatable, 8000);
});

test("R4.5 strong receivable included, weak excluded", () => {
  assert.equal(value({ kind: "receivable", id: "r1", label: "Loan to brother", amount: 1000, strength: "strong" }).trace.zakatable, 1000);
  assert.equal(value({ kind: "receivable", id: "r2", label: "Bankrupt client", amount: 1000, strength: "weak" }).trace.zakatable, 0);
});

test("R4.6 / R11.1 primary home is exempt", () => {
  const { trace } = value({ kind: "property", id: "h", label: "Home", use: "primary-home", marketValue: 500000 });
  assert.equal(trace.zakatable, 0);
  assert.ok(trace.rules.includes("R11.1"));
});

test("R6.3 ownership share scales the zakatable amount", () => {
  const { trace } = value({ kind: "cash", id: "j", label: "Joint account", amount: 10000, ownershipShare: 0.5 });
  assert.equal(trace.zakatable, 5000);
  assert.equal(trace.input, 10000);
  assert.ok(trace.rules.includes("R6.3"));
});

test("R8.1 inaccessible retirement is exempt with a warning", () => {
  const { trace, warnings } = value({ kind: "retirement", id: "p", label: "Locked pension", vestedBalance: 50000, accessible: false });
  assert.equal(trace.zakatable, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /prior years/);
});

test("R8.2 net-accessible: vested minus penalty, tax, fees", () => {
  const { trace } = value({ kind: "retirement", id: "k", label: "401k", vestedBalance: 100000, accessible: true, penaltyRate: 0.1, taxRate: 0.3, fees: 500 });
  assert.equal(trace.zakatable, 59500);
});

test("R8.2 long-term-proportional uses the stock proxy or exact ratio", () => {
  const s = resolveSettings("hanafi", { retirementMethod: "long-term-proportional" });
  const proxy = value({ kind: "retirement", id: "k", label: "401k", vestedBalance: 100000, accessible: true }, s).trace;
  assert.equal(proxy.zakatable, 25000);
  assert.equal(proxy.estimated, true);
  const exact = value({ kind: "retirement", id: "k", label: "401k", vestedBalance: 100000, accessible: true, underlyingZakatableRatio: 0.248 }, s).trace;
  assert.equal(exact.zakatable, 24800);
  assert.equal(exact.estimated, false);
});

test("R8.3 unvested balance is never counted", () => {
  const { trace } = value({ kind: "retirement", id: "k", label: "401k", vestedBalance: 60000, unvestedBalance: 15000, accessible: true }, resolveSettings("hanafi", { retirementMethod: "strict-full" }));
  assert.equal(trace.zakatable, 60000);
  assert.match(trace.note ?? "", /Unvested 15000 excluded/);
});

test("R8.5 strict-full takes the whole vested balance", () => {
  const { trace } = value({ kind: "retirement", id: "k", label: "401k", vestedBalance: 80000, accessible: true, penaltyRate: 0.1, taxRate: 0.3 }, resolveSettings("hanafi", { retirementMethod: "strict-full" }));
  assert.equal(trace.zakatable, 80000);
});

test("R9.1 actively traded stock at full market value", () => {
  const { trace } = value({ kind: "stock", id: "s", label: "Day trades", marketValue: 20000, intent: "trading" });
  assert.equal(trace.zakatable, 20000);
});

test("R9.2 long-term stock at 25 percent proxy by default, 30 when configured", () => {
  const a = value({ kind: "stock", id: "s", label: "Index fund", marketValue: 20000, intent: "long-term" }).trace;
  assert.equal(a.zakatable, 5000);
  assert.equal(a.estimated, true);
  const b = value({ kind: "stock", id: "s", label: "Index fund", marketValue: 20000, intent: "long-term" }, resolveSettings("hanafi", { stockProxyPercent: 30 })).trace;
  assert.equal(b.zakatable, 6000);
});

test("R9.2 exact zakatable-asset ratio overrides the proxy", () => {
  const { trace } = value({ kind: "stock", id: "s", label: "ACME", marketValue: 10000, intent: "long-term", zakatableAssetRatio: 0.42 });
  assert.equal(trace.zakatable, 4200);
  assert.equal(trace.estimated, false);
});

test("R10.1 crypto at full market value", () => {
  assert.equal(value({ kind: "crypto", id: "b", label: "BTC", marketValue: 3333.33 }).trace.zakatable, 3333.33);
});

test("R11.2 rental property value is not zakatable", () => {
  const { trace } = value({ kind: "property", id: "r", label: "Flat", use: "rental", marketValue: 300000 });
  assert.equal(trace.zakatable, 0);
  assert.match(trace.note ?? "", /counted as cash/);
});

test("R11.3 property for resale is trade goods", () => {
  const { trace } = value({ kind: "property", id: "l", label: "Plot", use: "for-resale", marketValue: 120000 });
  assert.equal(trace.zakatable, 120000);
});

test("R11.4 land with no intent is not zakatable", () => {
  assert.equal(value({ kind: "property", id: "l", label: "Plot", use: "held-no-intent", marketValue: 120000 }).trace.zakatable, 0);
});

test("R12.1 business net = inventory + cash + receivables - short-term liabilities", () => {
  const { trace } = value({ kind: "business", id: "biz", label: "Shop", inventoryMarketValue: 30000, cash: 5000, collectibleReceivables: 2000, doubtfulReceivables: 800, shortTermLiabilities: 7000, fixedAssets: 50000 });
  assert.equal(trace.zakatable, 30000);
  assert.equal(trace.input, 37000);
});

test("R12.1 business with negative net contributes zero and warns", () => {
  const { trace, warnings } = value({ kind: "business", id: "biz", label: "Shop", inventoryMarketValue: 1000, cash: 0, collectibleReceivables: 0, shortTermLiabilities: 5000 });
  assert.equal(trace.zakatable, 0);
  assert.equal(warnings.length, 1);
});

test("R13.1 HSA fully zakatable, R13.2 FSA not", () => {
  assert.equal(value({ kind: "other-account", id: "h", label: "HSA", subtype: "hsa", balance: 4000 }).trace.zakatable, 4000);
  assert.equal(value({ kind: "other-account", id: "f", label: "FSA", subtype: "fsa", balance: 4000 }).trace.zakatable, 0);
});

test("R13.3 savings bond at balance", () => {
  assert.equal(value({ kind: "other-account", id: "sb", label: "I-bond", subtype: "savings-bond", balance: 10000 }).trace.zakatable, 10000);
});

test("R13.4 529 net of penalty and tax, Junior ISA excluded from parent", () => {
  assert.equal(value({ kind: "other-account", id: "e", label: "529", subtype: "education-529", balance: 10000, penaltyRate: 0.1, taxRate: 0.2 }).trace.zakatable, 7000);
  const jisa = value({ kind: "other-account", id: "j", label: "JISA", subtype: "junior-isa", balance: 10000 });
  assert.equal(jisa.trace.zakatable, 0);
  assert.equal(jisa.warnings.length, 1);
});

test("R13.5 life insurance cash value is provisional and flagged", () => {
  const { trace, warnings } = value({ kind: "other-account", id: "li", label: "Whole life", subtype: "life-insurance-cash-value", balance: 15000 });
  assert.equal(trace.zakatable, 15000);
  assert.equal(trace.estimated, true);
  assert.equal(warnings.length, 1);
});

test("every asset trace carries at least one rule reference", () => {
  const assets: Asset[] = [
    { kind: "cash", id: "1", label: "", amount: 1 },
    { kind: "metal", id: "2", label: "", metal: "silver", grams: 1, purity: 1, usage: "bullion" },
    { kind: "trade-goods", id: "3", label: "", marketValue: 1 },
    { kind: "receivable", id: "4", label: "", amount: 1, strength: "strong" },
    { kind: "retirement", id: "5", label: "", vestedBalance: 1, accessible: true },
    { kind: "stock", id: "6", label: "", marketValue: 1, intent: "trading" },
    { kind: "crypto", id: "7", label: "", marketValue: 1 },
    { kind: "property", id: "8", label: "", use: "for-resale", marketValue: 1 },
    { kind: "business", id: "9", label: "", inventoryMarketValue: 1, cash: 0, collectibleReceivables: 0, shortTermLiabilities: 0 },
    { kind: "other-account", id: "10", label: "", subtype: "hsa", balance: 1 },
  ];
  for (const a of assets) {
    assert.ok(value(a).trace.rules.length > 0, a.kind);
  }
});
