import { isCashAccount } from "@hawl/statements";
import type { HijriDate } from "../lib/commands";
import { accountIntervals, formatInterval, monthCells, overallRange, uncovered } from "../lib/coverage";
import type { Profile } from "../lib/profile";

interface Props {
  profile: Profile;
  anniversary: HijriDate | null;
  windowStart: string | null;
}

/** What the imported statements cover, per account, against the hawl window. */
export default function CoverageCard({ profile, anniversary, windowStart }: Props) {
  const cashAccounts = profile.accounts.filter(isCashAccount);
  const cashImports = profile.imports.filter((i) => cashAccounts.some((a) => a.id === i.accountId));
  const overall = overallRange(cashImports);
  const window = windowStart && anniversary ? { from: windowStart, to: anniversary.gregorian } : overall;

  if (!overall || !window) {
    return (
      <section className="card">
        <h3 className="font-semibold">Coverage</h3>
        <p className="mt-1 text-sm text-ink/60">Nothing imported yet. Statements covering the whole hawl, for every cash account, give the most reliable result.</p>
      </section>
    );
  }

  const files = cashImports.length;
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">Coverage</h3>
        <p className="mt-1 text-sm text-ink/60">
          {files} statement{files === 1 ? "" : "s"} across {cashAccounts.length} cash account{cashAccounts.length === 1 ? "" : "s"}, covering <span className="num text-ink">{overall.from}</span> to <span className="num text-ink">{overall.to}</span>.
          {windowStart && anniversary ? (
            <>
              {" "}Your hawl runs <span className="num text-ink">{windowStart}</span> to <span className="num text-ink">{anniversary.gregorian}</span>.
            </>
          ) : (
            " Set your anniversary in Settings to compare this with your hawl."
          )}
        </p>
      </div>

      <div className="space-y-3">
        {cashAccounts.map((a) => {
          const intervals = accountIntervals(a, profile.imports);
          const cells = monthCells(intervals, window.from, window.to);
          const gaps = uncovered(intervals, window.from, window.to);
          return (
            <div key={a.id}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className={`text-xs ${gaps.length === 0 ? "text-moss-700" : "text-gold-600"}`}>
                  {gaps.length === 0
                    ? "complete for the hawl"
                    : `missing ${gaps.slice(0, 4).map(formatInterval).join(", ")}${gaps.length > 4 ? ` and ${gaps.length - 4} more` : ""}`}
                </span>
              </div>
              <div className="flex gap-1" role="img" aria-label={`${a.name}: ${cells.filter((c) => c.state === "full").length} of ${cells.length} months fully covered`}>
                {cells.map((c) => (
                  <div key={c.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${c.label} ${c.key.slice(0, 4)}: ${c.coveredDays} of ${c.days} days covered`}>
                    <div className={`h-3 w-full rounded-sm ${c.state === "full" ? "bg-moss-700" : c.state === "partial" ? "bg-moss-200" : "bg-sand-200"}`} />
                    <span className="text-[10px] leading-none text-ink/50">{c.label.charAt(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="help">Solid months are fully covered, light ones partly. A gap means the balance for those days is carried from the last statement before it, which the result notes.</p>
    </section>
  );
}
