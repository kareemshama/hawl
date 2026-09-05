import { useId, useMemo, useState } from "react";
import type { DailyBalance } from "@hawl/core-types";
import { money } from "../lib/format";

interface Props {
  series: DailyBalance[];
  nisab: number;
  currency: string;
  anniversary: string | null;
  /** The parent shows its own headline figures. */
  hideStats?: boolean;
}

// Validated with the dataviz palette checker (light surface): line #2f7d4a, threshold #b8860b.
const LINE = "#2f7d4a";
const THRESHOLD = "#b8860b";
const W = 720;
const H = 220;
const PAD = { top: 16, right: 24, bottom: 28, left: 64 };

export default function CarryOverChart({ series, nisab, currency, anniversary, hideStats = false }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const clipId = useId();

  const geom = useMemo(() => {
    const n = series.length;
    const xs = series.map((_, i) => PAD.left + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right)));
    const values = series.map((d) => d.total);
    const lo = Math.min(0, ...values, nisab);
    const hi = Math.max(...values, nisab) * 1.08 || 1;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y(values[i]!).toFixed(1)}`).join(" ");
    const area = `${path} L${xs[n - 1]!.toFixed(1)},${y(lo).toFixed(1)} L${xs[0]!.toFixed(1)},${y(lo).toFixed(1)} Z`;
    let lowIdx = 0;
    values.forEach((v, i) => {
      if (v < values[lowIdx]!) lowIdx = i;
    });
    const ticks = niceTicks(lo, hi, 4);
    const dips = series.filter((d) => d.total < nisab).length;
    return { xs, y, path, area, lowIdx, ticks, lo, hi, dips };
  }, [series, nisab]);

  const last = series[series.length - 1]!;
  const low = series[geom.lowIdx]!;
  const hovered = hover !== null ? series[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    geom.xs.forEach((x, i) => {
      const d = Math.abs(x - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(series.length - 1, (h ?? 0) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? series.length - 1) - 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(series.length - 1);
    else return;
    e.preventDefault();
  };

  // Month boundaries for the x axis.
  const monthTicks = series.map((d, i) => ({ d, i })).filter(({ d }, k, arr) => k === 0 || d.date.slice(0, 7) !== arr[k - 1]!.d.date.slice(0, 7));

  return (
    <div>
      {!hideStats && (
        <div className="mb-3 grid gap-3 text-sm sm:grid-cols-3">
          <Stat label="Lowest point" value={money(low.total, currency)} sub={low.date} tone={low.total < nisab ? "warn" : "ok"} />
          <Stat label={anniversary ? "On the anniversary" : "Latest"} value={money(last.total, currency)} sub={last.date} />
          <Stat label="Days below nisab" value={String(geom.dips)} sub={geom.dips === 0 ? "stayed above all year" : "hawl may have restarted (R2.2)"} tone={geom.dips === 0 ? "ok" : "warn"} />
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        role="img"
        aria-label={`Total cash balance across the hawl, from ${series[0]!.date} to ${last.date}. Lowest ${money(low.total, currency)} on ${low.date}. Nisab ${money(nisab, currency)}.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? series.length - 1)}
        onBlur={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={H} />
          </clipPath>
        </defs>
        {/* Gridlines and y ticks: hairline, recessive */}
        {geom.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(t)} y2={geom.y(t)} stroke="#e5e0d2" strokeWidth={1} />
            <text x={PAD.left - 8} y={geom.y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b6f6c" className="num">
              {compact(t)}
            </text>
          </g>
        ))}
        {/* X axis month labels */}
        {monthTicks.map(({ d, i }) => (
          <text key={d.date} x={geom.xs[i]} y={H - 8} textAnchor={i === 0 ? "start" : "middle"} fontSize={11} fill="#6b6f6c">
            {monthLabel(d.date)}
          </text>
        ))}
        {/* Nisab threshold */}
        <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(nisab)} y2={geom.y(nisab)} stroke={THRESHOLD} strokeWidth={1.5} />
        <text x={W - PAD.right} y={geom.y(nisab) - 5} textAnchor="end" fontSize={11} fill="#6b6f6c">
          Nisab {compact(nisab)}
        </text>
        {/* Area wash and line */}
        <g clipPath={`url(#${clipId})`}>
          <path d={geom.area} fill={LINE} fillOpacity={0.1} />
          <path d={geom.path} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {/* Lowest point marker with surface ring and direct label */}
        <circle cx={geom.xs[geom.lowIdx]} cy={geom.y(low.total)} r={6} fill="#ffffff" />
        <circle cx={geom.xs[geom.lowIdx]} cy={geom.y(low.total)} r={4} fill={low.total < nisab ? THRESHOLD : LINE} />
        <text x={geom.xs[geom.lowIdx]} y={geom.y(low.total) + 16} textAnchor={geom.lowIdx > series.length * 0.8 ? "end" : geom.lowIdx < series.length * 0.2 ? "start" : "middle"} fontSize={11} fill="#1b1f1c" className="num">
          low {compact(low.total)}
        </text>
        {/* End marker and label */}
        <circle cx={geom.xs[series.length - 1]} cy={geom.y(last.total)} r={6} fill="#ffffff" />
        <circle cx={geom.xs[series.length - 1]} cy={geom.y(last.total)} r={4} fill={LINE} />
        {/* Crosshair */}
        {hover !== null && hovered && (
          <g>
            <line x1={geom.xs[hover]} x2={geom.xs[hover]} y1={PAD.top} y2={H - PAD.bottom} stroke="#a89d84" strokeWidth={1} />
            <circle cx={geom.xs[hover]} cy={geom.y(hovered.total)} r={6} fill="#ffffff" />
            <circle cx={geom.xs[hover]} cy={geom.y(hovered.total)} r={4} fill={LINE} />
          </g>
        )}
      </svg>

      <div className="mt-1 flex min-h-[24px] items-center justify-between text-xs text-ink/60">
        <span>
          {hovered ? (
            <>
              <span className="num font-semibold text-ink">{money(hovered.total, currency)}</span> on {hovered.date}
              {hovered.total < nisab && <span className="ml-2 text-gold-600">below nisab</span>}
            </>
          ) : (
            "Hover or use arrow keys to read a day."
          )}
        </span>
        <button className="text-moss-700 hover:underline" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide table" : "Show table"}</button>
      </div>

      {showTable && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-sand-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sand-50 text-left text-xs uppercase text-ink/50">
              <tr>
                <th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5 text-right">Total cash</th>
                <th className="px-3 py-1.5 text-right">vs nisab</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date} className="border-t border-sand-100">
                  <td className="num px-3 py-1">{d.date}</td>
                  <td className="num px-3 py-1 text-right">{money(d.total, currency)}</td>
                  <td className="num px-3 py-1 text-right text-ink/60">{money(d.total - nisab, currency, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg bg-sand-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
      <div className={`text-xs ${tone === "warn" ? "text-gold-600" : tone === "ok" ? "text-moss-700" : "text-ink/50"}`}>{sub}</div>
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}K`;
  if (abs >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function monthLabel(date: string): string {
  const m = Number(date.slice(5, 7));
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
}
