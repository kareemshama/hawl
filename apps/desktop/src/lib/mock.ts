/**
 * Browser-only stand-ins for the Tauri commands, used when the UI runs in a plain browser
 * (Vite dev server opened in Chrome, headless QA). Never loaded inside the Tauri webview.
 *
 * Storage is localStorage. Hijri conversion uses the browser's own Umm al-Qura implementation,
 * which can differ from ICU4X by a day at month boundaries; that is acceptable for UI work and is
 * why the real app converts in Rust.
 */
import type { MetalPrices } from "@hawl/core-types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AiPage, AiStatus, DownloadProgress, HijriDate, StoreStatus } from "./commands";

const KEY = "hawl-mock-store";
const AI_KEY = "hawl-mock-ai";
const progressListeners = new Set<(p: DownloadProgress) => void>();

/**
 * Stand-in for the model: pulls "MM/DD[/YY] description amount" runs out of the page text and
 * takes the sign from the nearest section heading, the way a US bank statement is laid out.
 */
function mockExtract(text: string, periodStart: string | null): AiPage {
  const year = periodStart ? Number(periodStart.slice(0, 4)) : new Date().getFullYear();
  const rows: AiPage["rows"] = [];
  const re = /(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})(?=\s+\d{2}\/\d{2}|\s+Total|\s+Withdrawals|\s+Deposits|\s+Checks|\s+Service|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).toLowerCase();
    const lastOut = Math.max(before.lastIndexOf("withdrawal"), before.lastIndexOf("subtraction"), before.lastIndexOf("checks"), before.lastIndexOf("service fee"));
    const lastIn = Math.max(before.lastIndexOf("deposit"), before.lastIndexOf("addition"));
    const raw = Number(m[5]!.replace(/[$,]/g, ""));
    const amount = lastOut > lastIn && raw > 0 ? -raw : raw;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    rows.push({ date: `${y}-${m[1]}-${m[2]}`, description: m[4]!.trim(), amount, balance: null });
  }
  const bal = (label: RegExp) => {
    const hit = label.exec(text);
    return hit ? Number(hit[1]!.replace(/[$,]/g, "")) : null;
  };
  return {
    rows,
    periodStart: null,
    periodEnd: null,
    openingBalance: bal(/Beginning balance on [^$]*\$([\d,]+\.\d{2})/i),
    closingBalance: bal(/Ending balance on [^$]*\$([\d,]+\.\d{2})/i),
  };
}

const MONTHS = ["Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Ula", "Jumada al-Akhirah", "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qa'dah", "Dhu al-Hijjah"];

function delay<T>(v: T, ms = 60): Promise<T> {
  return new Promise((r) => setTimeout(() => r(v), ms));
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toHijriParts(iso: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
  const parts = fmt.formatToParts(new Date(`${iso}T00:00:00Z`));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function make(h: { year: number; month: number; day: number }, gregorian: string): HijriDate {
  return { ...h, monthName: MONTHS[h.month - 1] ?? "", label: `${h.day} ${MONTHS[h.month - 1]} ${h.year}`, gregorian };
}

function hijriToGregorianSearch(year: number, month: number, day: number): string {
  // Search a window of Gregorian dates around the expected position.
  const approx = new Date(Date.UTC(Math.floor(622 + (year - 1) * 0.970224) , 0, 1));
  approx.setUTCDate(approx.getUTCDate() + Math.round((month - 1) * 29.53 + day + ((year - 1) * 354.367) % 365.25));
  let iso = approx.toISOString().slice(0, 10);
  for (let i = 0; i < 800; i++) {
    const h = toHijriParts(iso);
    const diff = (year - h.year) * 354 + (month - h.month) * 29.5 + (day - h.day);
    if (Math.abs(diff) < 1) return iso;
    iso = shift(iso, Math.max(-400, Math.min(400, Math.round(diff))) || (diff > 0 ? 1 : -1));
  }
  return iso;
}

export const mock = {
  storeStatus: (): Promise<StoreStatus> => delay({ exists: localStorage.getItem(KEY) !== null, path: "localStorage (browser mock)" }),
  storeLoad: () => {
    const raw = localStorage.getItem(KEY);
    return delay(raw === null ? null : (JSON.parse(raw) as unknown));
  },
  storeSave: (profile: unknown) => {
    localStorage.setItem(KEY, JSON.stringify(profile));
    return delay(undefined);
  },
  storeDelete: () => {
    localStorage.removeItem(KEY);
    return delay(undefined);
  },
  // Local AI: "ready" once the mock setup ran (or localStorage hawl-mock-ai = "ready").
  aiStatus: (): Promise<AiStatus> => {
    const ready = localStorage.getItem(AI_KEY) === "ready";
    return delay({ engineReady: ready, modelReady: ready, modelLabel: "Qwen2.5 3B Instruct (browser mock)", gpuDetected: false, cudaBuild: false, usingGpu: false, running: false });
  },
  aiSetup: async (): Promise<AiStatus> => {
    for (let i = 1; i <= 5; i++) {
      await delay(undefined, 150);
      progressListeners.forEach((cb) => cb({ stage: "AI model (browser mock)", downloaded: i * 400 * 1024 * 1024, total: 2000 * 1024 * 1024, percent: i * 20 }));
    }
    localStorage.setItem(AI_KEY, "ready");
    return mock.aiStatus();
  },
  aiExtractPage: (text: string, periodStart: string | null): Promise<AiPage> => delay(mockExtract(text, periodStart), 200),
  aiSetGpu: () => delay(undefined),
  onAiProgress: (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> => {
    progressListeners.add(cb);
    return Promise.resolve(() => {
      progressListeners.delete(cb);
    });
  },
  fetchPrices: (currency: string): Promise<MetalPrices> =>
    delay({ currency, goldPerGram: 144.32, silverPerGram: 2.16, asOf: new Date().toISOString().slice(0, 10), source: "browser mock (fixed)" }, 300),
  hijriFromGregorian: (date: string, adjust: number) => delay(make(toHijriParts(shift(date, adjust)), date)),
  hijriToGregorian: (year: number, month: number, day: number, adjust: number) => {
    const g = shift(hijriToGregorianSearch(year, month, day), -adjust);
    return delay(make({ year, month, day }, g));
  },
  hijriNextOccurrence: async (month: number, day: number, from: string, adjust: number) => {
    const cur = toHijriParts(shift(from, adjust));
    for (let y = cur.year; y <= cur.year + 2; y++) {
      const g = shift(hijriToGregorianSearch(y, month, day), -adjust);
      if (g >= from) return make({ year: y, month, day }, g);
    }
    throw new Error("Could not find the next anniversary.");
  },
  hijriPreviousOccurrence: async (month: number, day: number, from: string, adjust: number) => {
    const cur = toHijriParts(shift(from, adjust));
    for (let y = cur.year; y >= cur.year - 2; y--) {
      const g = shift(hijriToGregorianSearch(y, month, day), -adjust);
      if (g <= from) return make({ year: y, month, day }, g);
    }
    throw new Error("Could not find the previous anniversary.");
  },
};
