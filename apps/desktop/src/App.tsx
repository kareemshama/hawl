import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset, CalculationResult, Liability, Trace } from "@hawl/core-types";
import { calculateZakat, computeNisab, yearLengthFor } from "@hawl/zakat-engine";
import { addDays, buildBalanceSeries, deriveCashAssets, type SeriesResult } from "@hawl/statements";
import {
  fetchPrices,
  hijriFromGregorian,
  hijriPreviousOccurrence,
  hijriToGregorian,
  storeCreate,
  storeLock,
  storeSave,
  storeStatus,
  storeUnlock,
  todayIso,
  type HijriDate,
} from "./lib/commands";
import { ASSET_FIELDS, ASSET_KINDS, LIABILITY_FIELDS, LIABILITY_KINDS } from "./lib/forms";
import { emptyProfile, normalizeProfile, pricesOf, settingsOf, type Profile } from "./lib/profile";
import ItemsPanel from "./components/ItemsPanel";
import ResultPanel from "./components/ResultPanel";
import SettingsPanel from "./components/SettingsPanel";
import SetupWizard from "./components/SetupWizard";
import StatementsPanel from "./components/StatementsPanel";
import YearsPanel from "./components/YearsPanel";
import TitleBar from "./components/TitleBar";
import UnlockScreen, { Crescent } from "./components/UnlockScreen";

type Screen = "loading" | "create" | "unlock" | "setup" | "main";
export type View = "overview" | "statements" | "assets" | "liabilities" | "years" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [view, setView] = useState<View>("overview");
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [anniversary, setAnniversary] = useState<HijriDate | null>(null);
  const [pricesBusy, setPricesBusy] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // --- Boot -----------------------------------------------------------------
  useEffect(() => {
    storeStatus()
      .then((s) => setScreen(s.exists ? "unlock" : "create"))
      .catch((e) => {
        setAuthError(String(e));
        setScreen("create");
      });
  }, []);

  const onCreate = async (passphrase: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const p = emptyProfile();
      await storeCreate(passphrase, p);
      setProfile(p);
      setScreen("setup");
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const onUnlock = async (passphrase: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const raw = await storeUnlock(passphrase);
      const p = normalizeProfile(raw);
      setProfile(p);
      setScreen(p.setupComplete ? "main" : "setup");
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const onLock = async () => {
    await storeLock();
    setProfile(emptyProfile());
    setAnniversary(null);
    setScreen("unlock");
  };

  // --- Persistence (debounced) ---------------------------------------------
  const skipSave = useRef(true);
  useEffect(() => {
    if (screen !== "main") return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(() => {
      storeSave(profile)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 400);
    return () => clearTimeout(t);
  }, [profile, screen]);

  const update = useCallback((p: Profile) => setProfile(p), []);

  // --- Anniversary date ------------------------------------------------------
  const settings = useMemo(() => settingsOf(profile), [profile]);
  useEffect(() => {
    if (screen !== "main") return;
    let live = true;
    const { month, day } = profile.anniversary;
    const adjust = settings.hijriAdjustmentDays;
    const req = profile.calcYear ? hijriToGregorian(profile.calcYear, month, day, adjust) : hijriPreviousOccurrence(month, day, todayIso(), adjust);
    req.then((d) => live && setAnniversary(d)).catch(() => live && setAnniversary(null));
    return () => {
      live = false;
    };
  }, [screen, profile.anniversary, profile.calcYear, settings.hijriAdjustmentDays]);

  // --- Prices ------------------------------------------------------------------
  const refreshPrices = useCallback(async () => {
    setPricesBusy(true);
    setPricesError(null);
    try {
      const p = await fetchPrices(profile.currency);
      setProfile((prev) => ({ ...prev, cachedPrices: p }));
    } catch (e) {
      setPricesError(String(e));
    } finally {
      setPricesBusy(false);
    }
  }, [profile.currency]);

  useEffect(() => {
    if (screen !== "main" || profile.manualPrices) return;
    const stale = !profile.cachedPrices || profile.cachedPrices.asOf !== todayIso() || profile.cachedPrices.currency !== profile.currency;
    if (stale) void refreshPrices();
    // Only on entering main or changing currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, profile.currency, profile.manualPrices]);

  // --- Statements: balance series and derived cash assets -------------------------
  const windowStart = useMemo(() => {
    if (!anniversary) return null;
    return profile.hawlStart ?? addDays(anniversary.gregorian, -yearLengthFor(settings));
  }, [anniversary, profile.hawlStart, settings]);

  const series = useMemo<SeriesResult | null>(() => {
    if (!anniversary || !windowStart || profile.accounts.length === 0) return null;
    return buildBalanceSeries({ accounts: profile.accounts, transactions: profile.transactions, imports: profile.imports, from: windowStart, to: anniversary.gregorian, baseCurrency: profile.currency });
  }, [anniversary, windowStart, profile.accounts, profile.transactions, profile.imports, profile.currency]);

  /** Cash assets taken from statement accounts on the anniversary (R4.1, R15.1). */
  const derivedAssets = useMemo<Asset[]>(() => {
    if (!anniversary) return [];
    return deriveCashAssets({ accounts: profile.accounts, transactions: profile.transactions, imports: profile.imports, date: anniversary.gregorian, baseCurrency: profile.currency }).assets;
  }, [anniversary, profile.accounts, profile.transactions, profile.imports, profile.currency]);

  /** R2.2: after a dip, move the anniversary to the Hijri date the hawl restarted. */
  const adoptRestart = async (restartedOn: string) => {
    try {
      const h = await hijriFromGregorian(restartedOn, settings.hijriAdjustmentDays);
      setProfile((p) => {
        const next: Profile = { ...p, anniversary: { month: h.month, day: h.day }, hawlStart: restartedOn };
        delete next.calcYear;
        return next;
      });
    } catch {
      // Leave the profile unchanged if the date cannot be converted.
    }
  };

  // --- Calculation ---------------------------------------------------------------
  const prices = pricesOf(profile);
  const nisabValue = useMemo(() => {
    if (!prices) return null;
    try {
      return computeNisab(settings, prices).value;
    } catch {
      return null;
    }
  }, [settings, prices]);

  const { result, error } = useMemo<{ result: CalculationResult | null; error: string | null }>(() => {
    if (!prices || !anniversary) return { result: null, error: null };
    try {
      const input = {
        settings,
        anniversary: { gregorian: anniversary.gregorian, hijri: `${anniversary.label} AH` },
        prices,
        assets: [...derivedAssets, ...profile.assets],
        liabilities: profile.liabilities,
        payer: profile.payer,
        ...(profile.hawlStart ? { hawlStart: profile.hawlStart } : {}),
        ...(series && series.series.length > 0 ? { balanceSeries: series.series } : {}),
      };
      return { result: calculateZakat(input), error: null };
    } catch (e) {
      return { result: null, error: String(e) };
    }
  }, [prices, anniversary, settings, derivedAssets, profile.assets, profile.liabilities, profile.payer, profile.hawlStart, series]);

  const traceMap = useMemo(() => {
    const m = new Map<string, Trace>();
    result?.traces.forEach((t) => m.set(t.id, t));
    return m;
  }, [result]);

  const saveYear = () => {
    if (!result || !anniversary) return;
    const entry = {
      hijriYear: anniversary.year,
      hijriLabel: anniversary.label,
      gregorian: anniversary.gregorian,
      savedAt: new Date().toISOString(),
      result,
      paid: false,
    };
    setProfile((p) => ({ ...p, history: [...p.history.filter((h) => h.hijriYear !== entry.hijriYear), entry] }));
  };

  const togglePaid = (hijriYear: number) => {
    setProfile((p) => ({
      ...p,
      history: p.history.map((h) => (h.hijriYear === hijriYear ? (h.paid ? { ...h, paid: false, paidOn: undefined } : { ...h, paid: true, paidOn: todayIso() }) : h)),
    }));
  };

  // --- Screens ---------------------------------------------------------------------
  if (screen === "loading") {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center text-ink/50">Loading...</div>
      </Shell>
    );
  }
  if (screen === "create" || screen === "unlock") {
    return (
      <Shell>
        <UnlockScreen mode={screen} busy={authBusy} error={authError} onSubmit={screen === "create" ? onCreate : onUnlock} />
      </Shell>
    );
  }
  if (screen === "setup") {
    return (
      <Shell>
        <SetupWizard
          profile={profile}
          onDone={(p) => {
            setProfile(p);
            skipSave.current = false;
            setScreen("main");
            void storeSave(p);
          }}
        />
      </Shell>
    );
  }

  const navItems: [View, string][] = [
    ["overview", "Overview"],
    ["statements", `Statements${profile.accounts.length ? ` (${profile.accounts.length})` : ""}`],
    ["assets", `Assets${profile.assets.length + derivedAssets.length ? ` (${profile.assets.length + derivedAssets.length})` : ""}`],
    ["liabilities", `Liabilities${profile.liabilities.length ? ` (${profile.liabilities.length})` : ""}`],
    ["years", "Past years"],
    ["settings", "Settings"],
  ];

  return (
    <Shell
      right={
        <span className="pr-3 text-xs text-ink/40">
          {saveState === "saving" && "Saving..."}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && <span className="text-red-700">Save failed</span>}
        </span>
      }
    >
      <div className="flex h-full min-h-0">
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-sand-200 bg-sand-50 p-3">
          <div className="mb-4 flex items-center gap-2 px-2 pt-1">
            <Crescent size={28} />
            <span className="font-semibold">Hawl</span>
          </div>
          {navItems.map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${view === v ? "bg-moss-700 text-white" : "text-ink/80 hover:bg-sand-200"}`}>
              {label}
            </button>
          ))}
          <div className="mt-auto px-2 text-xs text-ink/40">
            {profile.madhab === "custom" ? "Custom positions" : `${profile.madhab.charAt(0).toUpperCase()}${profile.madhab.slice(1)} preset`}
            {Object.keys(profile.overrides).length > 0 && ` with ${Object.keys(profile.overrides).length} override${Object.keys(profile.overrides).length === 1 ? "" : "s"}`}
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          {view === "overview" && (
            <ResultPanel
              result={result}
              error={error}
              anniversary={anniversary}
              prices={prices}
              pricesBusy={pricesBusy}
              pricesError={pricesError}
              currency={profile.currency}
              history={profile.history}
              onRefreshPrices={() => void refreshPrices()}
              onSaveYear={saveYear}
              onTogglePaid={togglePaid}
              onGoTo={setView}
              onAdoptRestart={(d) => void adoptRestart(d)}
            />
          )}
          {view === "statements" && <StatementsPanel profile={profile} onChange={update} series={series} anniversary={anniversary} nisabValue={nisabValue} windowStart={windowStart} />}
          {view === "assets" && (
            <ItemsPanel<Asset["kind"], Asset>
              title="Assets"
              intro="Everything you own that zakat can apply to, valued on the anniversary date. Bank balances from imported statements appear automatically; add anything else by hand."
              emptyText="No assets yet. Import a statement or add a balance by hand."
              items={profile.assets}
              readOnlyItems={derivedAssets}
              readOnlyBadge="from statements"
              kinds={ASSET_KINDS}
              fieldsFor={(k) => ASSET_FIELDS[k]}
              currency={profile.currency}
              traces={traceMap}
              figureWord="zakatable"
              onChange={(assets) => update({ ...profile, assets })}
              makeItem={(kind, value, id) => ({ ...(value as object), kind, id } as Asset)}
            />
          )}
          {view === "liabilities" && (
            <ItemsPanel<Liability["kind"], Liability>
              title="Liabilities"
              intro="Debts that reduce your zakatable wealth. Which ones count depends on the positions in Settings."
              emptyText="No liabilities. That is fine if you have none."
              items={profile.liabilities}
              kinds={LIABILITY_KINDS}
              fieldsFor={(k) => LIABILITY_FIELDS[k]}
              currency={profile.currency}
              traces={traceMap}
              figureWord="deductible"
              onChange={(liabilities) => update({ ...profile, liabilities })}
              makeItem={(kind, value, id) => ({ ...(value as object), kind, id } as Liability)}
            />
          )}
          {view === "years" && <YearsPanel profile={profile} settings={settings} prices={prices} current={anniversary} onChange={update} />}
          {view === "settings" && <SettingsPanel profile={profile} onChange={update} onLock={() => void onLock()} />}
        </main>
      </div>
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-sand-300">
      <TitleBar right={right} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
