import type { IsoDate, Liability, Settings, Trace } from "@hawl/core-types";
import { daysBetween, round2 } from "./util.js";

interface Ctx {
  settings: Settings;
  anniversary: IsoDate;
  warnings: string[];
}

/** Value one liability into a Trace. `zakatable` is the deductible amount (positive). */
export function valueLiability(liability: Liability, ctx: Ctx): Trace {
  const base = {
    id: liability.id,
    label: liability.label,
    category: "liability" as const,
    ...(liability.source ? { source: liability.source } : {}),
  };
  const finish = (input: number, deductible: number, rules: string[], extra: Partial<Trace> = {}): Trace => ({
    ...base,
    input: round2(input),
    zakatable: round2(Math.max(0, deductible)),
    rules,
    ...extra,
  });

  switch (liability.kind) {
    case "immediate":
      return finish(liability.amount, liability.amount, ["R5.1", "R5.4"]);

    case "credit-card":
      return finish(liability.balance, liability.balance, ["R5.3"], { note: "Full statement balance is demandable at any time." });

    case "long-term-loan": {
      if (ctx.settings.longTermDebtRule === "full-balance") {
        return finish(liability.outstandingBalance, liability.outstandingBalance, ["R5.2"], { note: "Full outstanding balance (AMJA-permitted alternative)." });
      }
      const twelve = liability.monthlyInstalment * 12;
      const deductible = Math.min(liability.outstandingBalance, twelve);
      return finish(liability.outstandingBalance, deductible, ["R5.2"], {
        note: `Next 12 instalments of ${round2(liability.monthlyInstalment)}, capped at the outstanding balance.`,
      });
    }

    case "upcoming-bill": {
      if (ctx.settings.upcomingBillsRule === "not-deductible") {
        return finish(liability.amount, 0, ["R5.5"], { note: "Not yet due, so not deductible under the selected position." });
      }
      if (liability.dueDate === undefined) {
        ctx.warnings.push(`${liability.label}: no due date given; treated as due within the current month.`);
        return finish(liability.amount, liability.amount, ["R5.5"], { note: "Assumed due within the current month.", estimated: true });
      }
      const days = daysBetween(ctx.anniversary, liability.dueDate);
      if (days >= 0 && days <= 30) {
        return finish(liability.amount, liability.amount, ["R5.5"], { note: `Due ${days} days after the anniversary.` });
      }
      return finish(liability.amount, 0, ["R5.5"], { note: days < 0 ? "Already past due; record it as an immediate debt instead." : "Due more than 30 days out." });
    }

    case "unpaid-zakat":
      return finish(liability.amount, liability.amount, ["R5.6", "R7.3"], {
        ...(liability.forYear ? { note: `Unpaid zakat for ${liability.forYear}.` } : {}),
      });
  }

  const unreachable: never = liability;
  throw new Error(`Unhandled liability: ${JSON.stringify(unreachable)}`);
}
