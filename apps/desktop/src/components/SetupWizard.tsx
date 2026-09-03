import { useEffect, useState } from "react";
import type { Madhab } from "@hawl/core-types";
import { HIJRI_MONTHS, hijriPreviousOccurrence, todayIso, type HijriDate } from "../lib/commands";
import { CURRENCIES, type Profile } from "../lib/profile";

interface Props {
  profile: Profile;
  onDone: (p: Profile) => void;
}

const MADHABS: { value: Madhab; label: string; blurb: string }[] = [
  { value: "hanafi", label: "Hanafi", blurb: "Silver nisab. Only the start and end of the year are checked. Jewellery is zakatable. Minors are not liable." },
  { value: "shafii", label: "Shafi'i", blurb: "Wealth must stay above nisab all year. Personal jewellery exempt. Minors' wealth is liable." },
  { value: "maliki", label: "Maliki", blurb: "Continuous nisab. Personal jewellery exempt. Minors' wealth is liable." },
  { value: "hanbali", label: "Hanbali", blurb: "Continuous nisab. Personal jewellery exempt. Minors' wealth is liable." },
  { value: "custom", label: "Custom", blurb: "Start from the common contemporary defaults and choose each position yourself in Settings." },
];

export default function SetupWizard({ profile, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [madhab, setMadhab] = useState<Madhab>(profile.madhab);
  const [currency, setCurrency] = useState(profile.currency);
  const [month, setMonth] = useState(profile.anniversary.month);
  const [day, setDay] = useState(profile.anniversary.day);
  const [knowsDate, setKnowsDate] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<HijriDate | null>(null);

  useEffect(() => {
    let live = true;
    hijriPreviousOccurrence(month, day, todayIso(), 0)
      .then((d) => live && setPreview(d))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [month, day]);

  const finish = () => {
    onDone({ ...profile, setupComplete: true, madhab, currency, anniversary: { month, day }, overrides: {} });
  };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-8">
      <div className="w-full max-w-2xl">
        <ol className="mb-6 flex gap-2 text-xs text-ink/50">
          {["School of law", "Currency", "Anniversary"].map((s, i) => (
            <li key={s} className={`rounded-full px-3 py-1 ${i === step ? "bg-moss-700 text-white" : i < step ? "bg-moss-100 text-moss-800" : "bg-sand-100"}`}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="card">
            <h2 className="text-lg font-semibold">Which positions should Hawl follow?</h2>
            <p className="mb-4 text-sm text-ink/60">Pick the school you follow. Every individual position stays adjustable in Settings, and every result cites the rule it used.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {MADHABS.map((m) => (
                <button key={m.value} type="button" onClick={() => setMadhab(m.value)} className={`rounded-xl border p-4 text-left transition-colors ${madhab === m.value ? "border-moss-600 bg-moss-50" : "border-sand-200 bg-white hover:bg-sand-50"}`}>
                  <div className="font-semibold">{m.label}</div>
                  <div className="mt-1 text-sm text-ink/60">{m.blurb}</div>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn-primary" onClick={() => setStep(1)}>Continue</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="card">
            <h2 className="text-lg font-semibold">Which currency do you count in?</h2>
            <p className="mb-4 text-sm text-ink/60">Gold and silver prices are fetched in US dollars and converted with the European Central Bank rate. If your currency is missing, choose the closest and enter prices by hand in Settings.</p>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
            <div className="mt-6 flex justify-between">
              <button className="btn-secondary" onClick={() => setStep(0)}>Back</button>
              <button className="btn-primary" onClick={() => setStep(2)}>Continue</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="card">
            <h2 className="text-lg font-semibold">When is your zakat anniversary?</h2>
            <p className="mb-4 text-sm text-ink/60">Zakat is due on the same Hijri date every year, one lunar year after your wealth first reached nisab (R2.1).</p>

            {knowsDate === null && (
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="rounded-xl border border-sand-200 bg-white p-4 text-left hover:bg-sand-50" onClick={() => setKnowsDate(true)}>
                  <div className="font-semibold">I know my date</div>
                  <div className="text-sm text-ink/60">Enter the Hijri month and day you pay on.</div>
                </button>
                <button
                  className="rounded-xl border border-sand-200 bg-white p-4 text-left hover:bg-sand-50"
                  onClick={() => {
                    setKnowsDate(false);
                    setMonth(9);
                    setDay(1);
                  }}
                >
                  <div className="font-semibold">I have never tracked it</div>
                  <div className="text-sm text-ink/60">Pick a fixed date going forward. Most people choose 1 Ramadan (R2.4).</div>
                </button>
              </div>
            )}

            {knowsDate !== null && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Hijri month</label>
                  <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {HIJRI_MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Day</label>
                  <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                    {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <p className="help sm:col-span-2">
                  {preview ? `Most recent occurrence: ${preview.label} AH, which was ${preview.gregorian} in the Umm al-Qura calendar. Adjust by a day in Settings if your community sights the moon locally (R2.6).` : "Computing the Gregorian date..."}
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button className="btn-secondary" onClick={() => (knowsDate === null ? setStep(1) : setKnowsDate(null))}>Back</button>
              <button className="btn-primary" onClick={finish} disabled={knowsDate === null}>Finish setup</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
