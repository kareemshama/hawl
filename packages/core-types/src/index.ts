/**
 * Shared types for Hawl.
 *
 * Every rule number in comments (R1.1, R5.2, ...) refers to docs/RULES.md.
 * All monetary amounts are in the profile's base currency. Currency conversion
 * happens before data reaches the engine and is recorded in Provenance.
 */

// ---------------------------------------------------------------------------
// Settings (RULES.md Part 4)
// ---------------------------------------------------------------------------

export type Madhab = "hanafi" | "shafii" | "maliki" | "hanbali" | "custom";
/** R1.3 */
export type NisabMetal = "silver" | "gold";
/** R1.1, R1.2: "standard" = 85 g / 595 g, "strict" = 87.48 g / 612.36 g */
export type NisabStandard = "standard" | "strict";
/** R2.2 */
export type HawlDipRule = "start-and-end" | "continuous";
/** R2.3 */
export type NewIncomeRule = "merge" | "separate";
/** R3.2 */
export type CalendarBasis = "hijri" | "gregorian";
/** R4.3 */
export type JewelleryRule = "zakatable" | "personal-use-exempt";
/** R5.2 */
export type LongTermDebtRule = "next-12-months" | "full-balance";
/** R5.5 */
export type UpcomingBillsRule = "not-deductible" | "current-month";
/** R8.2, R8.5 */
export type RetirementMethod = "net-accessible" | "long-term-proportional" | "strict-full";
/** R6.2 */
export type MinorsRule = "exempt" | "liable";

export interface Settings {
  madhab: Madhab;
  nisabMetal: NisabMetal;
  nisabStandard: NisabStandard;
  hawlDipRule: HawlDipRule;
  newIncomeRule: NewIncomeRule;
  calendarBasis: CalendarBasis;
  jewelleryRule: JewelleryRule;
  longTermDebtRule: LongTermDebtRule;
  upcomingBillsRule: UpcomingBillsRule;
  retirementMethod: RetirementMethod;
  /** R9.2: percent of market value treated as zakatable for long-term stock holdings. */
  stockProxyPercent: number;
  minorsRule: MinorsRule;
}

// ---------------------------------------------------------------------------
// Prices and dates
// ---------------------------------------------------------------------------

/** ISO calendar date, YYYY-MM-DD, Gregorian. */
export type IsoDate = string;

export interface MetalPrices {
  currency: string;
  goldPerGram: number;
  silverPerGram: number;
  asOf: IsoDate;
  source: string;
}

// ---------------------------------------------------------------------------
// Assets (R4, R8 to R13)
// ---------------------------------------------------------------------------

export interface Provenance {
  file?: string;
  line?: number;
  note?: string;
}

interface AssetBase {
  id: string;
  label: string;
  /** R6.3: fraction of this asset owned by the payer. Defaults to 1. */
  ownershipShare?: number;
  source?: Provenance;
}

/** R4.1 */
export interface CashAsset extends AssetBase {
  kind: "cash";
  amount: number;
}

/** R4.2, R4.3 */
export interface MetalAsset extends AssetBase {
  kind: "metal";
  metal: "gold" | "silver";
  grams: number;
  /** Fraction of pure metal, 0 to 1. 24k = 1, 22k = 0.9167, 18k = 0.75, sterling = 0.925. */
  purity: number;
  usage: "bullion" | "personal-jewellery" | "investment-jewellery";
}

/** R4.4 */
export interface TradeGoodsAsset extends AssetBase {
  kind: "trade-goods";
  marketValue: number;
}

/** R4.5 */
export interface ReceivableAsset extends AssetBase {
  kind: "receivable";
  amount: number;
  strength: "strong" | "weak";
}

/** R8 */
export interface RetirementAsset extends AssetBase {
  kind: "retirement";
  vestedBalance: number;
  unvestedBalance?: number;
  /** R8.1: can the holder legally withdraw before the due date, even with penalty? */
  accessible: boolean;
  /** Fraction, e.g. 0.10 for a 10 percent early-withdrawal penalty. */
  penaltyRate?: number;
  /** Fraction of the withdrawal that would go to tax. */
  taxRate?: number;
  fees?: number;
  /** R8.2 long-term method: fraction of the underlying funds that is zakatable. Falls back to stockProxyPercent. */
  underlyingZakatableRatio?: number;
}

/** R9 */
export interface StockAsset extends AssetBase {
  kind: "stock";
  marketValue: number;
  intent: "trading" | "long-term";
  /** R9.2 exact method: (current assets - current liabilities) / market cap. Falls back to stockProxyPercent. */
  zakatableAssetRatio?: number;
}

/** R10 */
export interface CryptoAsset extends AssetBase {
  kind: "crypto";
  marketValue: number;
}

/** R11 */
export interface PropertyAsset extends AssetBase {
  kind: "property";
  use: "primary-home" | "rental" | "for-resale" | "held-no-intent";
  marketValue: number;
}

/** R12 */
export interface BusinessAsset extends AssetBase {
  kind: "business";
  inventoryMarketValue: number;
  cash: number;
  collectibleReceivables: number;
  doubtfulReceivables?: number;
  shortTermLiabilities: number;
  fixedAssets?: number;
}

/** R13 */
export interface OtherAccountAsset extends AssetBase {
  kind: "other-account";
  subtype: "hsa" | "fsa" | "savings-bond" | "education-529" | "junior-isa" | "life-insurance-cash-value";
  balance: number;
  penaltyRate?: number;
  taxRate?: number;
}

export type Asset =
  | CashAsset
  | MetalAsset
  | TradeGoodsAsset
  | ReceivableAsset
  | RetirementAsset
  | StockAsset
  | CryptoAsset
  | PropertyAsset
  | BusinessAsset
  | OtherAccountAsset;

// ---------------------------------------------------------------------------
// Liabilities (R5)
// ---------------------------------------------------------------------------

interface LiabilityBase {
  id: string;
  label: string;
  source?: Provenance;
}

/** R5.1, R5.4: due now or within the year, bills already due, taxes owed. */
export interface ImmediateDebt extends LiabilityBase {
  kind: "immediate";
  amount: number;
}

/** R5.3 */
export interface CreditCardDebt extends LiabilityBase {
  kind: "credit-card";
  balance: number;
}

/** R5.2 */
export interface LongTermLoan extends LiabilityBase {
  kind: "long-term-loan";
  outstandingBalance: number;
  monthlyInstalment: number;
}

/** R5.5 */
export interface UpcomingBill extends LiabilityBase {
  kind: "upcoming-bill";
  amount: number;
  dueDate?: IsoDate;
}

/** R5.6, R7.3 */
export interface UnpaidZakat extends LiabilityBase {
  kind: "unpaid-zakat";
  amount: number;
  forYear?: string;
}

export type Liability = ImmediateDebt | CreditCardDebt | LongTermLoan | UpcomingBill | UnpaidZakat;

// ---------------------------------------------------------------------------
// Calculation input and output
// ---------------------------------------------------------------------------

/** One day's total cash balance across all accounts, for hawl checks (R15). */
export interface DailyBalance {
  date: IsoDate;
  total: number;
  /** Nisab value on that day if a historical price is known. Otherwise the current nisab is used and marked estimated. */
  nisabValue?: number;
}

export interface Payer {
  isMinor?: boolean;
  lacksCapacity?: boolean;
}

export interface CalculationInput {
  settings: Settings;
  anniversary: {
    gregorian: IsoDate;
    /** Display label such as "1 Ramadan 1448". Conversion happens outside the engine (R2.5, R2.6). */
    hijri?: string;
  };
  /** Gregorian date the current hawl began. Needed for the continuous dip rule. */
  hawlStart?: IsoDate;
  prices: MetalPrices;
  assets: Asset[];
  liabilities: Liability[];
  payer?: Payer;
  balanceSeries?: DailyBalance[];
}

export type TraceCategory = "asset" | "liability" | "nisab" | "hawl" | "rate" | "payer" | "adjustment" | "total";

/** One line of the audit trail. The UI renders these directly. */
export interface Trace {
  id: string;
  label: string;
  category: TraceCategory;
  /** The raw figure the user supplied or the statement showed. */
  input: number;
  /** The amount that entered the zakat base (positive for assets, positive for deductions). */
  zakatable: number;
  /** Rule numbers from docs/RULES.md. */
  rules: string[];
  note?: string;
  estimated?: boolean;
  source?: Provenance;
}

export type Verdict = "due" | "exempt" | "hawl-not-complete" | "not-liable";

export interface NisabResult {
  metal: NisabMetal;
  standard: NisabStandard;
  grams: number;
  pricePerGram: number;
  value: number;
}

export interface HawlStatus {
  rule: HawlDipRule;
  complete: boolean;
  checkedDays: number;
  lowestTotal?: number;
  lowestOn?: IsoDate;
  brokenOn?: IsoDate;
  restartedOn?: IsoDate;
  /** Gregorian estimate, restart date plus one lunar year. The caller converts it to Hijri. */
  proposedAnniversary?: IsoDate;
  estimated: boolean;
  note: string;
}

export interface CalculationResult {
  verdict: Verdict;
  nisab: NisabResult;
  totals: {
    zakatableAssets: number;
    deductibleLiabilities: number;
    netZakatableWealth: number;
  };
  rate: number;
  zakatDue: number;
  hawl: HawlStatus | undefined;
  traces: Trace[];
  warnings: string[];
  settings: Settings;
  anniversary: CalculationInput["anniversary"];
  prices: MetalPrices;
}
