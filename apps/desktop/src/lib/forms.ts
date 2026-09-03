/**
 * Declarative field specs for the asset and liability forms. Each spec maps a flat draft of
 * strings and booleans to a typed Asset or Liability and back. Percent fields are entered as
 * whole numbers (10 for 10 percent) and stored as fractions.
 */
import type { Asset, Liability } from "@hawl/core-types";

export type FieldType = "text" | "money" | "number" | "percent" | "select" | "checkbox";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly { value: string; label: string }[];
  help?: string;
  /** Show only when another field has one of these values. */
  when?: { key: string; in: readonly string[] };
  optional?: boolean;
}

export type Draft = Record<string, string | boolean>;

export const ASSET_KINDS: readonly { value: Asset["kind"]; label: string; rules: string }[] = [
  { value: "cash", label: "Cash or bank balance", rules: "R4.1" },
  { value: "metal", label: "Gold or silver", rules: "R4.2, R4.3" },
  { value: "stock", label: "Stocks, ETFs, funds", rules: "R9" },
  { value: "retirement", label: "Retirement account", rules: "R8" },
  { value: "crypto", label: "Cryptocurrency", rules: "R10" },
  { value: "receivable", label: "Money owed to you", rules: "R4.5" },
  { value: "trade-goods", label: "Trade goods or inventory", rules: "R4.4" },
  { value: "property", label: "Property", rules: "R11" },
  { value: "business", label: "Business", rules: "R12" },
  { value: "other-account", label: "Other account", rules: "R13" },
];

const shareField: FieldSpec = { key: "ownershipShare", label: "Your ownership share", type: "percent", help: "100 unless the asset is shared (R6.3).", optional: true };

export const ASSET_FIELDS: Record<Asset["kind"], FieldSpec[]> = {
  cash: [
    { key: "label", label: "Name", type: "text" },
    { key: "amount", label: "Balance", type: "money" },
    shareField,
  ],
  metal: [
    { key: "label", label: "Name", type: "text" },
    { key: "metal", label: "Metal", type: "select", options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
    { key: "grams", label: "Weight in grams", type: "number" },
    {
      key: "purity",
      label: "Purity",
      type: "select",
      options: [
        { value: "1", label: "24k / fine (99.9%)" },
        { value: "0.9167", label: "22k (91.7%)" },
        { value: "0.875", label: "21k (87.5%)" },
        { value: "0.75", label: "18k (75%)" },
        { value: "0.5833", label: "14k (58.3%)" },
        { value: "0.925", label: "Sterling silver (92.5%)" },
      ],
    },
    {
      key: "usage",
      label: "Use",
      type: "select",
      options: [
        { value: "bullion", label: "Bullion or coins" },
        { value: "personal-jewellery", label: "Jewellery worn personally" },
        { value: "investment-jewellery", label: "Jewellery kept as investment" },
      ],
      help: "Personal jewellery is exempt under Shafi'i, Maliki, and Hanbali, zakatable under Hanafi (R4.3).",
    },
    shareField,
  ],
  stock: [
    { key: "label", label: "Name", type: "text" },
    { key: "marketValue", label: "Market value", type: "money" },
    {
      key: "intent",
      label: "Intent",
      type: "select",
      options: [
        { value: "long-term", label: "Long-term holding" },
        { value: "trading", label: "Active trading" },
      ],
      help: "Trading positions are fully zakatable (R9.1). Long-term holdings use the zakatable-assets proxy (R9.2).",
    },
    { key: "zakatableAssetRatio", label: "Exact zakatable-asset ratio", type: "percent", optional: true, when: { key: "intent", in: ["long-term"] }, help: "Leave blank to use the proxy from Settings." },
    shareField,
  ],
  retirement: [
    { key: "label", label: "Name", type: "text" },
    { key: "vestedBalance", label: "Vested balance", type: "money" },
    { key: "unvestedBalance", label: "Unvested balance", type: "money", optional: true, help: "Excluded (R8.3)." },
    { key: "accessible", label: "I could legally withdraw before the due date, even with a penalty", type: "checkbox", help: "If not, the account is exempt until accessed (R8.1)." },
    { key: "penaltyRate", label: "Early withdrawal penalty", type: "percent", optional: true, when: { key: "accessible", in: ["true"] } },
    { key: "taxRate", label: "Tax on withdrawal", type: "percent", optional: true, when: { key: "accessible", in: ["true"] } },
    { key: "fees", label: "Withdrawal fees", type: "money", optional: true, when: { key: "accessible", in: ["true"] } },
    { key: "underlyingZakatableRatio", label: "Underlying zakatable ratio", type: "percent", optional: true, when: { key: "accessible", in: ["true"] }, help: "Only used by the long-term method (R8.2)." },
    shareField,
  ],
  crypto: [
    { key: "label", label: "Name", type: "text" },
    { key: "marketValue", label: "Market value", type: "money" },
    shareField,
  ],
  receivable: [
    { key: "label", label: "Name", type: "text" },
    { key: "amount", label: "Amount owed to you", type: "money" },
    {
      key: "strength",
      label: "Likelihood of repayment",
      type: "select",
      options: [
        { value: "strong", label: "Strong: reliable, solvent debtor" },
        { value: "weak", label: "Weak: doubtful or disputed" },
      ],
    },
  ],
  "trade-goods": [
    { key: "label", label: "Name", type: "text" },
    { key: "marketValue", label: "Current selling value", type: "money" },
    shareField,
  ],
  property: [
    { key: "label", label: "Name", type: "text" },
    {
      key: "use",
      label: "Use",
      type: "select",
      options: [
        { value: "primary-home", label: "Primary home (exempt)" },
        { value: "rental", label: "Rental property (value exempt, income counted as cash)" },
        { value: "for-resale", label: "Bought to resell (fully zakatable)" },
        { value: "held-no-intent", label: "Held with no plan (exempt)" },
      ],
    },
    { key: "marketValue", label: "Market value", type: "money" },
    shareField,
  ],
  business: [
    { key: "label", label: "Business name", type: "text" },
    { key: "inventoryMarketValue", label: "Inventory at selling price", type: "money" },
    { key: "cash", label: "Business cash", type: "money" },
    { key: "collectibleReceivables", label: "Collectible receivables", type: "money" },
    { key: "doubtfulReceivables", label: "Doubtful receivables", type: "money", optional: true },
    { key: "shortTermLiabilities", label: "Short-term liabilities", type: "money" },
    { key: "fixedAssets", label: "Fixed assets (for the record, exempt)", type: "money", optional: true },
    shareField,
  ],
  "other-account": [
    { key: "label", label: "Name", type: "text" },
    {
      key: "subtype",
      label: "Type",
      type: "select",
      options: [
        { value: "hsa", label: "HSA" },
        { value: "fsa", label: "FSA (exempt)" },
        { value: "savings-bond", label: "Savings bond" },
        { value: "education-529", label: "529 education account" },
        { value: "junior-isa", label: "Junior ISA (child-vested)" },
        { value: "life-insurance-cash-value", label: "Life insurance cash value" },
      ],
    },
    { key: "balance", label: "Balance", type: "money" },
    { key: "penaltyRate", label: "Withdrawal penalty", type: "percent", optional: true, when: { key: "subtype", in: ["education-529"] } },
    { key: "taxRate", label: "Tax on withdrawal", type: "percent", optional: true, when: { key: "subtype", in: ["education-529"] } },
    shareField,
  ],
};

export const LIABILITY_KINDS: readonly { value: Liability["kind"]; label: string; rules: string }[] = [
  { value: "credit-card", label: "Credit card balance", rules: "R5.3" },
  { value: "long-term-loan", label: "Mortgage, car, or student loan", rules: "R5.2" },
  { value: "immediate", label: "Bill or debt already due", rules: "R5.1, R5.4" },
  { value: "upcoming-bill", label: "Upcoming bill not yet due", rules: "R5.5" },
  { value: "unpaid-zakat", label: "Unpaid zakat from a prior year", rules: "R5.6, R7.3" },
];

export const LIABILITY_FIELDS: Record<Liability["kind"], FieldSpec[]> = {
  "credit-card": [
    { key: "label", label: "Name", type: "text" },
    { key: "balance", label: "Statement balance", type: "money" },
  ],
  "long-term-loan": [
    { key: "label", label: "Name", type: "text" },
    { key: "outstandingBalance", label: "Outstanding balance", type: "money" },
    { key: "monthlyInstalment", label: "Monthly instalment", type: "money", help: "By default only the next 12 instalments are deducted (R5.2)." },
  ],
  immediate: [
    { key: "label", label: "Name", type: "text" },
    { key: "amount", label: "Amount", type: "money" },
  ],
  "upcoming-bill": [
    { key: "label", label: "Name", type: "text" },
    { key: "amount", label: "Amount", type: "money" },
    { key: "dueDate", label: "Due date", type: "text", optional: true, help: "YYYY-MM-DD. Deductible only if Settings allow the current month's bills (R5.5)." },
  ],
  "unpaid-zakat": [
    { key: "label", label: "Name", type: "text" },
    { key: "amount", label: "Amount", type: "money" },
    { key: "forYear", label: "For Hijri year", type: "text", optional: true },
  ],
};

const DEFAULTS: Record<string, string | boolean> = {
  metal: "gold",
  purity: "1",
  usage: "bullion",
  intent: "long-term",
  strength: "strong",
  use: "primary-home",
  subtype: "hsa",
  accessible: true,
};

export function emptyDraft(fields: FieldSpec[]): Draft {
  const d: Draft = {};
  for (const f of fields) {
    if (f.type === "checkbox") d[f.key] = DEFAULTS[f.key] === true;
    else if (f.type === "select") d[f.key] = String(DEFAULTS[f.key] ?? f.options?.[0]?.value ?? "");
    else d[f.key] = "";
  }
  return d;
}

export function draftFrom(item: Record<string, unknown>, fields: FieldSpec[]): Draft {
  const d = emptyDraft(fields);
  for (const f of fields) {
    const v = item[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "checkbox") d[f.key] = Boolean(v);
    else if (f.type === "percent") d[f.key] = String(Math.round(Number(v) * 10000) / 100);
    else d[f.key] = String(v);
  }
  return d;
}

export function isVisible(f: FieldSpec, draft: Draft): boolean {
  if (!f.when) return true;
  return f.when.in.includes(String(draft[f.when.key]));
}

/** Returns a typed object or a list of validation errors. */
export function buildFromDraft(fields: FieldSpec[], draft: Draft): { value: Record<string, unknown>; errors: string[] } {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of fields) {
    if (!isVisible(f, draft)) continue;
    const raw = draft[f.key];
    if (f.type === "checkbox") {
      value[f.key] = raw === true;
      continue;
    }
    const s = String(raw ?? "").trim();
    if (s === "") {
      if (!f.optional) errors.push(`${f.label} is required.`);
      continue;
    }
    if (f.type === "text") {
      value[f.key] = s;
      continue;
    }
    if (f.type === "select") {
      value[f.key] = f.key === "purity" ? Number(s) : s;
      continue;
    }
    const n = Number(s.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n)) {
      errors.push(`${f.label} must be a number.`);
      continue;
    }
    if (n < 0) {
      errors.push(`${f.label} cannot be negative.`);
      continue;
    }
    if (f.type === "percent") {
      if (n > 100) errors.push(`${f.label} cannot exceed 100 percent.`);
      value[f.key] = n / 100;
    } else {
      value[f.key] = n;
    }
  }
  return { value, errors };
}
