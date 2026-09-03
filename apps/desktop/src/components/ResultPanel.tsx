import type { CalculationResult, MetalPrices } from "@hawl/core-types";
import type { HijriDate } from "../lib/commands";
import { money, pct } from "../lib/format";
import type { SavedYear } from "../lib/profile";

interface Props {
  result: CalculationResult | null;
  error: string | null;
  anniversary: HijriDate | null;
  prices: MetalPrices | null;
  pricesBusy: boolean;
  pricesError: string | null;
  currency: string;
  history: SavedYear[];
  onRefreshPrices: () => void;
  onSaveYear: () => void;
  onTogglePaid: (hijriYear: number) => void;
  onGoTo: (view: "assets" | "liabilities" | "settings") => void;
}

const VERDICT: Record<CalculationResult["verdict"], { title: string; tone: string }> = {
  due: { title: "Zakat is due", tone: "bg-moss-700 text-white" },
  exempt: { title: "No zakat due this year", tone: "bg-sand-200 text-ink" },
  "hawl-not-complete": { title: "Hawl not yet complete", tone: "bg-gold-100 text-ink" },
  "not-liable": { title: "Not personally liable", tone: "bg-sand-200 text-ink" },
};

export default function ResultPanel(p: Props) {
  const { result, currency } = p;
  const alreadySaved = result && p.anniversary ? p.history.some((h) => h.hijriYear === p.anniversary!.year) : false;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Overview</h2>
          <p className="mt-1 text-sm text-ink/60">
            {p.anniversary ? (
              <>Anniversary {p.anniversary.label} AH, {p.anniversary.gregorian}</>
            ) : (
              "Working out your anniversary..."
            )}
          </p>
        </div>
        <PriceChip prices={p.prices} busy={p.pricesBusy} error={p.pricesError} onRefresh={p.onRefreshPrices} onManual={() => p.onGoTo("settings")} />
      </header>

      {p.error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{p.error}</div>}

      {!result && !p.error && (
        <div className="card text-ink/60">
          {p.prices ? "Add your assets to see a result." : "Waiting for gold and silver prices. If you are offline, enter them by hand in Settings."}
        </div>
      )}

      {result && (
        <>
          <section className={`rounded-2xl p-6 ${VERDICT[result.verdict].tone}`}>
            <div className="text-sm uppercase tracking-wide opacity-80">{VERDICT[result.verdict].title}</div>
            <div className="num mt-1 text-4xl font-semibold">{money(result.zakatDue, currency)}</div>
            <div className="mt-2 text-sm opacity-90">
              {result.verdict === "due" && <>{pct(result.rate, 4)} of net zakatable wealth {money(result.totals.netZakatableWealth, currency)}.</>}
              {result.verdict === "exempt" && <>Net zakatable wealth {money(result.totals.netZakatableWealth, currency)} is below the nisab of {money(result.nisab.value, currency)}.</>}
              {result.verdict === "hawl-not-complete" && <>{result.hawl?.note}</>}
              {result.verdict === "not-liable" && <>Under the selected position a minor or someone lacking capacity is not personally liable (R6.2).</>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {result.verdict === "due" && !alreadySaved && (
                <button className="btn bg-white/95 text-moss-800 hover:bg-white" onClick={p.onSaveYear}>Record this year</button>
              )}
              {alreadySaved && <span className="btn bg-white/20 text-current">Recorded</span>}
              {result.totals.zakatableAssets === 0 && (
                <button className="btn bg-white/20 text-current hover:bg-white/30" onClick={() => p.onGoTo("assets")}>Add assets</button>
              )}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label="Zakatable assets" value={money(result.totals.zakatableAssets, currency)} />
            <Stat label="Deductible liabilities" value={money(result.totals.deductibleLiabilities, currency)} />
            <Stat label={`Nisab (${result.nisab.grams} g ${result.nisab.metal})`} value={money(result.nisab.value, currency)} />
          </section>

          {result.warnings.length > 0 && (
            <section className="rounded-xl border border-gold-400/50 bg-gold-100/60 px-4 py-3 text-sm">
              <div className="mb-1 font-medium">Things to check</div>
              <ul className="list-disc space-y-1 pl-5 text-ink/80">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card overflow-hidden p-0">
            <div className="flex items-center justify-between px-5 py-4">
              <h3 className="font-semibold">Audit trail</h3>
              <span className="text-xs text-ink/50">Every line cites docs/RULES.md</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="px-5 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Input</th>
                    <th className="px-3 py-2 text-right">Counted</th>
                    <th className="px-5 py-2">Rules</th>
                  </tr>
                </thead>
                <tbody>
                  {result.traces.map((t) => (
                    <tr key={t.id} className="border-t border-sand-100 align-top">
                      <td className="px-5 py-2">
                        <div className="font-medium">{t.label}</div>
                        {t.note && <div className="text-xs text-ink/60">{t.note}</div>}
                        {t.source?.file && <div className="text-xs text-ink/40">{t.source.file}{t.source.line ? `:${t.source.line}` : ""}</div>}
                      </td>
                      <td className="num px-3 py-2 text-right text-ink/70">{formatCell(t.category, t.input, currency)}</td>
                      <td className="num px-3 py-2 text-right font-medium">
                        {formatCell(t.category, t.zakatable, currency)}
                        {t.estimated && <span className="ml-1 text-xs text-gold-600" title="Estimated or approximate">~</span>}
                      </td>
                      <td className="px-5 py-2">
                        <div className="flex flex-wrap gap-1">
                          {t.rules.map((r) => (
                            <span key={r} className="rule">{r}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {p.history.length > 0 && (
        <section className="card">
          <h3 className="mb-3 font-semibold">Recorded years</h3>
          <ul className="divide-y divide-sand-100">
            {[...p.history].sort((a, b) => b.hijriYear - a.hijriYear).map((h) => (
              <li key={h.hijriYear} className="flex items-center justify-between gap-4 py-2 text-sm">
                <div>
                  <div className="font-medium">{h.hijriLabel} AH</div>
                  <div className="text-xs text-ink/50">{h.gregorian}, recorded {h.savedAt.slice(0, 10)}</div>
                </div>
                <div className="num font-semibold">{money(h.result.zakatDue, h.result.prices.currency)}</div>
                <button className={`btn px-3 text-sm ${h.paid ? "bg-moss-100 text-moss-800" : "btn-secondary"}`} onClick={() => p.onTogglePaid(h.hijriYear)}>
                  {h.paid ? `Paid ${h.paidOn ?? ""}` : "Mark paid"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatCell(category: string, n: number, currency: string): string {
  if (category === "rate") return pct(n, 4);
  if (category === "hawl") return `${n} days`;
  if (category === "payer") return "";
  return money(n, currency);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card py-4">
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function PriceChip({ prices, busy, error, onRefresh, onManual }: { prices: MetalPrices | null; busy: boolean; error: string | null; onRefresh: () => void; onManual: () => void }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white px-3 py-2 text-xs">
      {prices ? (
        <div className="flex items-center gap-3">
          <span>
            Gold <span className="num font-medium">{money(prices.goldPerGram, prices.currency)}</span>/g
          </span>
          <span>
            Silver <span className="num font-medium">{money(prices.silverPerGram, prices.currency)}</span>/g
          </span>
          <span className="text-ink/50">{prices.source.split(",")[0]}, {prices.asOf}</span>
          <button className="text-moss-700 hover:underline" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing" : "Refresh"}</button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-ink/60">{busy ? "Fetching prices..." : error ? "Prices unavailable" : "No prices yet"}</span>
          <button className="text-moss-700 hover:underline" onClick={onRefresh} disabled={busy}>Retry</button>
          <button className="text-moss-700 hover:underline" onClick={onManual}>Enter by hand</button>
        </div>
      )}
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}
