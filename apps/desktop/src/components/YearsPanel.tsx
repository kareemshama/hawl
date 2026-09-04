import { useEffect, useMemo, useState } from "react";
import type { CalculationInput, MetalPrices, Settings } from "@hawl/core-types";
import { calculateMissedYears, type MissedYearsResult } from "@hawl/zakat-engine";
import { deriveCashAssets } from "@hawl/statements";
import { hijriToGregorian, type HijriDate } from "../lib/commands";
import { money } from "../lib/format";
import type { Profile, SavedYear } from "../lib/profile";

interface Props {
  profile: Profile;
  settings: Settings;
  prices: MetalPrices | null;
  current: HijriDate | null;
  onChange: (p: Profile) => void;
}

interface YearRow {
  year: number;
  date: HijriDate;
}

type Computed =
  | { ok: true; result: MissedYearsResult; missingByYear: Record<number, string[]>; estimatedPrice: Record<number, boolean> }
  | { ok: false; error: string; missingByYear: Record<number, string[]>; estimatedPrice: Record<number, boolean> };

/**
 * Missed-year reconstruction (R7). Walks back over past Hijri years, values each anniversary from
 * statement history, and cascades unpaid zakat forward as a debt (R7.3).
 */
export default function YearsPanel({ profile, settings, prices, current, onChange }: Props) {
  const thisYear = current?.year ?? 1447;
  const [from, setFrom] = useState(thisYear - 3);
  const [to, setTo] = useState(thisYear - 1);
  const [includeManual, setIncludeManual] = useState(false);
  const [includeLiabilities, setIncludeLiabilities] = useState(false);
  const [priceOverrides, setPriceOverrides] = useState<Record<number, { gold: string; silver: string }>>({});
  const [rows, setRows] = useState<YearRow[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const years: number[] = [];
    for (let y = Math.min(from, to); y <= Math.max(from, to); y++) years.push(y);
    if (years.length === 0 || years.length > 30) {
      setRows([]);
      setDateError(years.length > 30 ? "Choose a range of 30 years or fewer." : null);
      return;
    }
    Promise.all(years.map((y) => hijriToGregorian(y, profile.anniversary.month, profile.anniversary.day, settings.hijriAdjustmentDays).then((date) => ({ year: y, date }))))
      .then((r) => {
        if (!live) return;
        setRows(r);
        setDateError(null);
      })
      .catch((e) => live && setDateError(String(e)));
    return () => {
      live = false;
    };
  }, [from, to, profile.anniversary, settings.hijriAdjustmentDays]);

  const computed = useMemo<Computed | null>(() => {
    if (!prices || rows.length === 0) return null;
    const inputs: CalculationInput[] = [];
    const missingByYear: Record<number, string[]> = {};
    const estimatedPrice: Record<number, boolean> = {};
    for (const r of rows) {
      const derived = deriveCashAssets({ accounts: profile.accounts, transactions: profile.transactions, imports: profile.imports, date: r.date.gregorian, baseCurrency: profile.currency });
      missingByYear[r.year] = derived.missing.map((a) => a.name);
      const o = priceOverrides[r.year];
      const gold = o && Number(o.gold) > 0 ? Number(o.gold) : prices.goldPerGram;
      const silver = o && Number(o.silver) > 0 ? Number(o.silver) : prices.silverPerGram;
      estimatedPrice[r.year] = !(o && Number(o.gold) > 0 && Number(o.silver) > 0);
      inputs.push({
        settings,
        anniversary: { gregorian: r.date.gregorian, hijri: `${r.date.label} AH` },
        prices: { ...prices, goldPerGram: gold, silverPerGram: silver, asOf: r.date.gregorian, source: estimatedPrice[r.year] ? `${prices.source} (today's price used as an estimate)` : "entered by hand" },
        assets: [...derived.assets, ...(includeManual ? profile.assets : [])],
        liabilities: includeLiabilities ? profile.liabilities : [],
        payer: profile.payer,
      });
    }
    const paid = new Set<number>();
    rows.forEach((r, i) => {
      if (profile.history.find((h) => h.hijriYear === r.year)?.paid) paid.add(i);
    });
    try {
      const result = calculateMissedYears(inputs, { paid });
      return { ok: true, result, missingByYear, estimatedPrice };
    } catch (e) {
      return { ok: false, error: String(e), missingByYear, estimatedPrice };
    }
  }, [prices, rows, profile, settings, includeManual, includeLiabilities, priceOverrides]);

  const record = () => {
    if (!computed || !computed.ok) return;
    const entries: SavedYear[] = computed.result.years
      .map((res, i) => ({ res, row: rows[i]! }))
      .filter(({ res, row }) => res.zakatDue > 0 && !profile.history.some((h) => h.hijriYear === row.year))
      .map(({ res, row }) => ({ hijriYear: row.year, hijriLabel: row.date.label, gregorian: row.date.gregorian, savedAt: new Date().toISOString(), result: res, paid: false }));
    if (entries.length === 0) return;
    onChange({ ...profile, history: [...profile.history, ...entries] });
  };

  const currency = profile.currency;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Past years</h2>
        <p className="mt-1 text-sm text-ink/60">
          Reconstruct years you did not calculate. Each year is valued on its own anniversary from your statement history, and unpaid zakat carries into the next year as a debt (R7). Estimates in good faith are accepted where records are missing (R7.4).
        </p>
      </header>

      <section className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">From Hijri year</label>
          <input className="input num" inputMode="numeric" value={from} onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setFrom(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">To Hijri year</label>
          <input className="input num" inputMode="numeric" value={to} onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setTo(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-moss-700" checked={includeManual} onChange={(e) => setIncludeManual(e.target.checked)} />
          Include today's manually entered assets in every year (gold, stocks, retirement) as if unchanged
        </label>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-moss-700" checked={includeLiabilities} onChange={(e) => setIncludeLiabilities(e.target.checked)} />
          Include today's liabilities in every year as if unchanged
        </label>
        {dateError && <p className="text-sm text-red-700 sm:col-span-2">{dateError}</p>}
        {!prices && <p className="text-sm text-ink/60 sm:col-span-2">Gold and silver prices are needed first. Fetch them on the Overview or enter them in Settings.</p>}
      </section>

      {computed && !computed.ok && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{computed.error}</div>}

      {computed && computed.ok && (
        <section className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="font-semibold">Reconstruction</h3>
              <p className="text-xs text-ink/50">Nisab uses today's metal prices unless you enter the price for that year. Look up historical prices at nzf.org.uk/nisab or a bullion dealer's chart.</p>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-ink/50">Total still owed</div>
              <div className="num text-xl font-semibold">{money(computed.result.totalOwed, currency)}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-ink/50">
                <tr>
                  <th className="px-4 py-2">Year</th>
                  <th className="px-3 py-2">Anniversary</th>
                  <th className="px-3 py-2 text-right">Net wealth</th>
                  <th className="px-3 py-2 text-right">Nisab</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2 text-right">Due</th>
                  <th className="px-3 py-2">Gold / silver per g</th>
                </tr>
              </thead>
              <tbody>
                {computed.result.years.map((res, i) => {
                  const row = rows[i]!;
                  const missing = computed.missingByYear[row.year] ?? [];
                  const recorded = profile.history.find((h) => h.hijriYear === row.year);
                  const o = priceOverrides[row.year] ?? { gold: "", silver: "" };
                  return (
                    <tr key={row.year} className="border-t border-sand-100 align-top">
                      <td className="num px-4 py-2 font-medium">{row.year}</td>
                      <td className="px-3 py-2">
                        <div className="num">{row.date.gregorian}</div>
                        <div className="text-xs text-ink/50">{row.date.label}</div>
                        {missing.length > 0 && <div className="text-xs text-gold-600">No history for {missing.join(", ")}</div>}
                      </td>
                      <td className="num px-3 py-2 text-right">{money(res.totals.netZakatableWealth, currency)}</td>
                      <td className="num px-3 py-2 text-right">
                        {money(res.nisab.value, currency)}
                        {computed.estimatedPrice[row.year] && <span className="ml-1 text-gold-600" title="Today's price used as an estimate">~</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${res.verdict === "due" ? "bg-moss-100 text-moss-800" : "bg-sand-100 text-ink/70"}`}>{res.verdict}</span>
                        {recorded && <div className="mt-1 text-xs text-ink/50">{recorded.paid ? `Paid ${recorded.paidOn ?? ""}` : "Recorded, unpaid"}</div>}
                      </td>
                      <td className="num px-3 py-2 text-right font-medium">{money(res.zakatDue, currency)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <input className="input num w-24 py-1" inputMode="decimal" placeholder={String(prices?.goldPerGram ?? "")} value={o.gold} onChange={(e) => setPriceOverrides((p) => ({ ...p, [row.year]: { gold: e.target.value, silver: o.silver } }))} aria-label={`Gold price per gram for ${row.year}`} />
                          <input className="input num w-20 py-1" inputMode="decimal" placeholder={String(prices?.silverPerGram ?? "")} value={o.silver} onChange={(e) => setPriceOverrides((p) => ({ ...p, [row.year]: { gold: o.gold, silver: e.target.value } }))} aria-label={`Silver price per gram for ${row.year}`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 px-5 py-4">
            <p className="text-xs text-ink/60">Years already marked paid in Recorded years are not carried forward. Recording adds each unpaid year to your history where you can mark it paid.</p>
            <button className="btn-primary" onClick={record} disabled={!computed.result.years.some((r, i) => r.zakatDue > 0 && !profile.history.some((h) => h.hijriYear === rows[i]!.year))}>
              Record unpaid years
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
