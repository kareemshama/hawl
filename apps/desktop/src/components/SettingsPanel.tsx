import { useState } from "react";
import type { Madhab, MetalPrices, Settings } from "@hawl/core-types";
import { PRESETS, DEFAULT_SETTINGS } from "@hawl/zakat-engine";
import { HIJRI_MONTHS } from "../lib/commands";
import { CURRENCIES, settingsOf, type Profile } from "../lib/profile";
import AiSetupCard, { useAiStatus } from "./AiSetup";

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
  storePath: string | null;
  onDeleteAll: () => Promise<void>;
}

interface Choice<K extends keyof Settings> {
  key: K;
  label: string;
  rule: string;
  options: { value: Settings[K]; label: string }[];
}

const CHOICES: Choice<keyof Settings>[] = [
  { key: "nisabMetal", label: "Nisab metal for cash and mixed wealth", rule: "R1.3", options: [{ value: "silver", label: "Silver (lower threshold, contemporary consensus)" }, { value: "gold", label: "Gold" }] },
  { key: "nisabStandard", label: "Nisab weights", rule: "R1.1, R1.2", options: [{ value: "standard", label: "85 g gold / 595 g silver" }, { value: "strict", label: "87.48 g gold / 612.36 g silver" }] },
  { key: "hawlDipRule", label: "If wealth dips below nisab mid-year", rule: "R2.2", options: [{ value: "start-and-end", label: "Only the start and end matter (Hanafi)" }, { value: "continuous", label: "The hawl restarts (Shafi'i, Maliki, Hanbali)" }] },
  { key: "newIncomeRule", label: "Income received during the year", rule: "R2.3", options: [{ value: "merge", label: "Merges into the running hawl (Hanafi, practical default)" }, { value: "separate", label: "Starts its own hawl (lowest balance of the year is used)" }] },
  { key: "calendarBasis", label: "Calendar", rule: "R2.5, R3.2", options: [{ value: "hijri", label: "Hijri year at 2.5 percent" }, { value: "gregorian", label: "Gregorian year at 2.5775 percent" }] },
  { key: "jewelleryRule", label: "Gold and silver jewellery worn personally", rule: "R4.3", options: [{ value: "zakatable", label: "Zakatable (Hanafi)" }, { value: "personal-use-exempt", label: "Exempt (Shafi'i, Maliki, Hanbali)" }] },
  { key: "longTermDebtRule", label: "Mortgages and long-term loans", rule: "R5.2", options: [{ value: "next-12-months", label: "Deduct the next 12 instalments" }, { value: "full-balance", label: "Deduct the full balance" }] },
  { key: "upcomingBillsRule", label: "Bills not yet due", rule: "R5.5", options: [{ value: "not-deductible", label: "Not deductible (majority)" }, { value: "current-month", label: "Deduct bills due within 30 days" }] },
  { key: "retirementMethod", label: "Accessible retirement accounts", rule: "R8.2, R8.5", options: [{ value: "net-accessible", label: "Vested balance net of penalty and tax" }, { value: "long-term-proportional", label: "Long-term investment proxy" }, { value: "strict-full", label: "Full vested balance (strict)" }] },
  { key: "minorsRule", label: "Wealth of minors and those lacking capacity", rule: "R6.2", options: [{ value: "exempt", label: "Not liable (Hanafi)" }, { value: "liable", label: "Liable, guardian pays (majority)" }] },
  { key: "hijriAdjustmentDays", label: "Moonsighting adjustment to Umm al-Qura dates", rule: "R2.6", options: [{ value: -1, label: "One day earlier" }, { value: 0, label: "None" }, { value: 1, label: "One day later" }] },
] as Choice<keyof Settings>[];

export default function SettingsPanel({ profile, onChange, storePath, onDeleteAll }: Props) {
  const settings = settingsOf(profile);
  const ai = useAiStatus();
  const preset = profile.madhab === "custom" ? DEFAULT_SETTINGS : PRESETS[profile.madhab];

  const setOverride = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const overrides = { ...profile.overrides };
    if (preset[key] === value) delete overrides[key];
    else (overrides as Record<string, unknown>)[key] = value;
    onChange({ ...profile, overrides });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-ink/60">Each choice is a documented position, not a preference. Changing the school resets every position to that school's defaults.</p>
      </header>

      <section className="card space-y-4">
        <h3 className="font-semibold">School of law</h3>
        <select className="input" value={profile.madhab} onChange={(e) => onChange({ ...profile, madhab: e.target.value as Madhab, overrides: {} })}>
          <option value="hanafi">Hanafi</option>
          <option value="shafii">Shafi'i</option>
          <option value="maliki">Maliki</option>
          <option value="hanbali">Hanbali</option>
          <option value="custom">Custom</option>
        </select>
      </section>

      <section className="card space-y-5">
        <h3 className="font-semibold">Positions</h3>
        {CHOICES.map((c) => (
          <div key={c.key}>
            <label className="label flex items-center gap-2">
              {c.label}
              <span className="rule">{c.rule}</span>
              {profile.overrides[c.key] !== undefined && <span className="text-xs text-gold-600">overridden</span>}
            </label>
            <select className="input" value={String(settings[c.key])} onChange={(e) => setOverride(c.key, coerce(c.key, e.target.value))}>
              {c.options.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <label className="label flex items-center gap-2">
            Long-term stock proxy
            <span className="rule">R9.2</span>
          </label>
          <div className="relative">
            <input className="input num pr-10" inputMode="decimal" value={settings.stockProxyPercent} onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0 && n <= 100) setOverride("stockProxyPercent", n);
            }} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink/50">%</span>
          </div>
          <p className="help">NZF uses 25, Joe Bradford 30. Enter an exact ratio per holding to bypass the proxy.</p>
        </div>
      </section>

      <section className="card space-y-4">
        <h3 className="font-semibold">Anniversary and payer</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Hijri month</label>
            <select className="input" value={profile.anniversary.month} onChange={(e) => onChange({ ...profile, anniversary: { ...profile.anniversary, month: Number(e.target.value) } })}>
              {HIJRI_MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Day</label>
            <select className="input" value={profile.anniversary.day} onChange={(e) => onChange({ ...profile, anniversary: { ...profile.anniversary, day: Number(e.target.value) } })}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Hijri year to calculate</label>
            <input className="input num" inputMode="numeric" placeholder="Most recent" value={profile.calcYear ?? ""} onChange={(e) => {
              const v = e.target.value.trim();
              const next = { ...profile };
              if (v === "") delete next.calcYear;
              else if (/^\d{4}$/.test(v)) next.calcYear = Number(v);
              onChange(next);
            }} />
            <p className="help">Leave blank for the most recent anniversary. Set a past year to reconstruct a missed one (R7).</p>
          </div>
          <div>
            <label className="label">Hawl start date</label>
            <input className="input num" placeholder="YYYY-MM-DD, optional" value={profile.hawlStart ?? ""} onChange={(e) => {
              const v = e.target.value.trim();
              const next = { ...profile };
              if (v === "") delete next.hawlStart;
              else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) next.hawlStart = v;
              else return;
              onChange(next);
            }} />
            <p className="help">Gregorian date your wealth first reached nisab (R2.1). Leave blank to assume one year before the anniversary.</p>
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={profile.currency} onChange={(e) => onChange({ ...profile, currency: e.target.value, cachedPrices: null })}>
              {CURRENCIES.map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-5 w-5 accent-moss-700" checked={profile.payer.isMinor === true} onChange={(e) => onChange({ ...profile, payer: { ...profile.payer, isMinor: e.target.checked } })} />
          <span className="text-sm">This profile belongs to a minor <span className="rule ml-1">R6.2</span></span>
        </label>
      </section>

      <ManualPrices profile={profile} onChange={onChange} />

      <AiSetupCard status={ai.status} onChanged={ai.refresh} />

      <section className="card space-y-3">
        <h3 className="font-semibold">Your data</h3>
        <p className="text-sm text-ink/60">Everything you enter is kept in one file on this computer and nowhere else. Copy that file to back it up. Delete it here when you no longer need it.</p>
        {storePath && <p className="help break-all">{storePath}</p>}
        <DeleteAllData onConfirm={onDeleteAll} />
      </section>
    </div>
  );
}

function coerce<K extends keyof Settings>(key: K, raw: string): Settings[K] {
  if (key === "hijriAdjustmentDays" || key === "stockProxyPercent") return Number(raw) as Settings[K];
  return raw as Settings[K];
}

function ManualPrices({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const manual = profile.manualPrices;
  const [gold, setGold] = useState(manual ? String(manual.goldPerGram) : "");
  const [silver, setSilver] = useState(manual ? String(manual.silverPerGram) : "");
  const apply = () => {
    const g = Number(gold);
    const s = Number(silver);
    if (!(g > 0 && s > 0)) return;
    const prices: MetalPrices = { currency: profile.currency, goldPerGram: g, silverPerGram: s, asOf: new Date().toISOString().slice(0, 10), source: "entered by hand" };
    onChange({ ...profile, manualPrices: prices });
  };
  return (
    <section className="card space-y-3">
      <h3 className="font-semibold">Gold and silver prices</h3>
      <p className="text-sm text-ink/60">Live prices come from gold-api.com with swissquote as a fallback, converted with ECB rates. Enter prices per gram here to override them, for example from nzf.org.uk/nisab.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Gold per gram ({profile.currency})</label>
          <input className="input num" inputMode="decimal" value={gold} onChange={(e) => setGold(e.target.value)} />
        </div>
        <div>
          <label className="label">Silver per gram ({profile.currency})</label>
          <input className="input num" inputMode="decimal" value={silver} onChange={(e) => setSilver(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={apply} disabled={!(Number(gold) > 0 && Number(silver) > 0)}>Use these prices</button>
        {manual && (
          <button className="btn-secondary" onClick={() => { onChange({ ...profile, manualPrices: null }); setGold(""); setSilver(""); }}>Back to live prices</button>
        )}
      </div>
      {manual && <p className="help">Manual prices in use since {manual.asOf}.</p>}
    </section>
  );
}

function DeleteAllData({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>Delete all data</button>;
  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-900">This removes every account, statement, asset, liability, recorded year, and setting from this computer. There is no undo. Hawl restarts at the setup wizard.</p>
      {error && <p className="text-sm text-red-800">{error}</p>}
      <div className="flex gap-2">
        <button
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
            } catch (e) {
              setError(String(e));
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting..." : "Yes, delete everything"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
