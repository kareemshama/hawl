import type { Asset, MetalPrices, Settings, Trace } from "@hawl/core-types";
import { assertNever, clamp01, metalPrice, pct, round2 } from "./util.js";

interface Ctx {
  settings: Settings;
  prices: MetalPrices;
  warnings: string[];
}

/**
 * Value one asset into a Trace. The zakatable figure already includes the ownership share.
 * Rules are cited per branch so the UI can show them.
 */
export function valueAsset(asset: Asset, ctx: Ctx): Trace {
  const share = asset.ownershipShare === undefined ? 1 : clamp01(asset.ownershipShare);
  const shareRules = asset.ownershipShare !== undefined && asset.ownershipShare !== 1 ? ["R6.3"] : [];
  const base = { id: asset.id, label: asset.label, category: "asset" as const, ...(asset.source ? { source: asset.source } : {}) };

  const finish = (input: number, zakatable: number, rules: string[], extra: Partial<Trace> = {}): Trace => ({
    ...base,
    input: round2(input),
    zakatable: round2(Math.max(0, zakatable) * share),
    rules: [...rules, ...shareRules],
    ...extra,
  });

  /** Net of penalty and tax, floored at zero, warning if the deductions swallow everything. */
  const netOfPenaltyAndTax = (gross: number, penaltyRate: number | undefined, taxRate: number | undefined, fees = 0) => {
    const penalty = clamp01(penaltyRate ?? 0);
    const tax = clamp01(taxRate ?? 0);
    if (penalty + tax >= 1) {
      ctx.warnings.push(`${asset.label}: penalty plus tax is ${pct(penalty + tax)} percent, so nothing is zakatable. Check that the rates are fractions (0.1 for 10 percent).`);
    }
    return { net: Math.max(0, gross * (1 - penalty - tax) - fees), penalty, tax };
  };

  switch (asset.kind) {
    case "cash":
      return finish(asset.amount, asset.amount, ["R4.1"]);

    case "metal": {
      const pricePerGram = metalPrice(ctx.prices, asset.metal);
      const value = asset.grams * clamp01(asset.purity) * pricePerGram;
      if (asset.usage === "personal-jewellery" && ctx.settings.jewelleryRule === "personal-use-exempt") {
        return finish(value, 0, ["R4.2", "R4.3"], { note: "Personal-use jewellery is exempt under the selected position." });
      }
      const rules = asset.usage === "bullion" ? ["R4.2"] : ["R4.2", "R4.3"];
      return finish(value, value, rules, {
        note: `${asset.grams} g at ${pct(asset.purity)} percent purity x ${pricePerGram} ${ctx.prices.currency}/g`,
      });
    }

    case "trade-goods":
      return finish(asset.marketValue, asset.marketValue, ["R4.4"]);

    case "receivable":
      if (asset.strength === "weak") {
        return finish(asset.amount, 0, ["R4.5"], { note: "Doubtful debt is excluded until collected." });
      }
      return finish(asset.amount, asset.amount, ["R4.5"]);

    case "retirement": {
      const vested = asset.vestedBalance;
      const unvestedNote = asset.unvestedBalance ? ` Unvested ${round2(asset.unvestedBalance)} excluded (R8.3).` : "";
      if (!asset.accessible) {
        ctx.warnings.push(`${asset.label}: inaccessible retirement funds are exempt this year; zakat for all prior years becomes due when they are accessed (R8.1).`);
        return finish(vested, 0, ["R8.1", "R8.3"], { note: `Not legally accessible before the due date.${unvestedNote}` });
      }
      const method = ctx.settings.retirementMethod;
      switch (method) {
        case "net-accessible": {
          const { net, penalty, tax } = netOfPenaltyAndTax(vested, asset.penaltyRate, asset.taxRate, asset.fees ?? 0);
          return finish(vested, net, ["R8.1", "R8.2", "R8.3"], {
            note: `Vested balance minus ${pct(penalty)} percent penalty, ${pct(tax)} percent tax, and ${round2(asset.fees ?? 0)} fees.${unvestedNote}`,
          });
        }
        case "long-term-proportional": {
          const ratio = clamp01(asset.underlyingZakatableRatio ?? ctx.settings.stockProxyPercent / 100);
          const usedProxy = asset.underlyingZakatableRatio === undefined;
          return finish(vested, vested * ratio, ["R8.2", "R8.3", "R9.2"], {
            note: `Treated as a long-term investment at ${pct(ratio)} percent zakatable.${unvestedNote}`,
            estimated: usedProxy,
          });
        }
        case "strict-full":
          return finish(vested, vested, ["R8.5", "R8.3"], { note: `Strict view: full vested balance.${unvestedNote}` });
        default:
          return assertNever(method, "retirement method");
      }
    }

    case "stock": {
      if (asset.intent === "trading") {
        return finish(asset.marketValue, asset.marketValue, ["R9.1"]);
      }
      const ratio = clamp01(asset.zakatableAssetRatio ?? ctx.settings.stockProxyPercent / 100);
      const usedProxy = asset.zakatableAssetRatio === undefined;
      return finish(asset.marketValue, asset.marketValue * ratio, ["R9.2"], {
        note: usedProxy
          ? `Long-term holding at the ${ctx.settings.stockProxyPercent} percent proxy.`
          : `Long-term holding at the exact zakatable-asset ratio of ${pct(ratio)} percent.`,
        estimated: usedProxy,
      });
    }

    case "crypto":
      return finish(asset.marketValue, asset.marketValue, ["R10.1"]);

    case "property": {
      const use = asset.use;
      switch (use) {
        case "primary-home":
          return finish(asset.marketValue, 0, ["R11.1", "R4.6"], { note: "Primary residence is exempt." });
        case "rental":
          return finish(asset.marketValue, 0, ["R11.2"], { note: "Property value is not zakatable. Rental income held on the due date is counted as cash." });
        case "for-resale":
          return finish(asset.marketValue, asset.marketValue, ["R11.3", "R4.4"]);
        case "held-no-intent":
          return finish(asset.marketValue, 0, ["R11.4"], { note: "No trade intent, not zakatable." });
        default:
          return assertNever(use, "property use");
      }
    }

    case "business": {
      const gross = asset.inventoryMarketValue + asset.cash + asset.collectibleReceivables;
      const net = gross - asset.shortTermLiabilities;
      const parts = [`inventory ${round2(asset.inventoryMarketValue)}`, `cash ${round2(asset.cash)}`, `receivables ${round2(asset.collectibleReceivables)}`, `minus short-term liabilities ${round2(asset.shortTermLiabilities)}`];
      if (asset.doubtfulReceivables) parts.push(`doubtful receivables ${round2(asset.doubtfulReceivables)} excluded`);
      if (asset.fixedAssets) parts.push(`fixed assets ${round2(asset.fixedAssets)} excluded`);
      if (net < 0) {
        ctx.warnings.push(
          `${asset.label}: short-term liabilities exceed the business's zakatable assets by ${round2(-net)}. The business contributes zero here. If you are personally liable for its debts (sole trader or partner), add ${round2(-net)} as a debt already due under Liabilities so it reduces your personal wealth (R5.1). A company's debts are not yours.`,
        );
      }
      return finish(gross, net, ["R12.1", "R12.2", "R12.3"], { note: parts.join(", ") });
    }

    case "other-account": {
      const subtype = asset.subtype;
      switch (subtype) {
        case "hsa":
          return finish(asset.balance, asset.balance, ["R13.1"]);
        case "fsa":
          return finish(asset.balance, 0, ["R13.2"], { note: "Forfeitable balance is not owned wealth." });
        case "savings-bond":
          return finish(asset.balance, asset.balance, ["R13.3"]);
        case "education-529": {
          const { net } = netOfPenaltyAndTax(asset.balance, asset.penaltyRate, asset.taxRate);
          return finish(asset.balance, net, ["R13.4", "R8.2"], { note: "Parent-controlled education account, net of penalty and tax." });
        }
        case "junior-isa":
          ctx.warnings.push(`${asset.label}: child-vested accounts are excluded from the parent; treatment for the child is flagged for scholarly review (R13.4).`);
          return finish(asset.balance, 0, ["R13.4"], { note: "Vests in the child, excluded from the parent.", estimated: true });
        case "life-insurance-cash-value":
          ctx.warnings.push(`${asset.label}: life insurance cash value is provisionally treated as zakatable pending scholarly review (R13.5).`);
          return finish(asset.balance, asset.balance, ["R13.5"], { note: "Provisional: accessible cash-surrender value.", estimated: true });
        default:
          return assertNever(subtype, "other-account subtype");
      }
    }

    default:
      return assertNever(asset, "asset");
  }
}
