/**
 * Browser-only stand-ins for the Tauri commands, used when the UI runs in a plain browser
 * (Vite dev server opened in Chrome, headless QA). Never loaded inside the Tauri webview.
 *
 * Storage is localStorage without encryption. Hijri conversion uses the browser's own Umm al-Qura
 * implementation, which can differ from ICU4X by a day at month boundaries; that is acceptable for
 * UI work and is why the real app converts in Rust.
 */
import type { MetalPrices } from "@hawl/core-types";
import type { HijriDate, StoreStatus } from "./commands";

const KEY = "hawl-mock-store";
const PASS_KEY = "hawl-mock-pass";
let unlocked = false;

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
  storeStatus: (): Promise<StoreStatus> => delay({ exists: localStorage.getItem(KEY) !== null, unlocked, path: "localStorage (browser mock)" }),
  storeCreate: (passphrase: string, profile: unknown) => {
    if (localStorage.getItem(KEY) !== null) return Promise.reject("A store already exists. Unlock it instead.");
    if (passphrase.length < 8) return Promise.reject("Passphrase must be at least 8 characters.");
    localStorage.setItem(KEY, JSON.stringify(profile));
    localStorage.setItem(PASS_KEY, passphrase);
    unlocked = true;
    return delay(undefined);
  },
  storeUnlock: (passphrase: string) => {
    if (localStorage.getItem(PASS_KEY) !== passphrase) return Promise.reject("Wrong passphrase, or the store is corrupted.");
    unlocked = true;
    return delay(JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown);
  },
  storeSave: (profile: unknown) => {
    if (!unlocked) return Promise.reject("Store is locked.");
    localStorage.setItem(KEY, JSON.stringify(profile));
    return delay(undefined);
  },
  storeLock: () => {
    unlocked = false;
    return delay(undefined);
  },
  storeChangePassphrase: (current: string, next: string) => {
    if (localStorage.getItem(PASS_KEY) !== current) return Promise.reject("Wrong passphrase.");
    localStorage.setItem(PASS_KEY, next);
    return delay(undefined);
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
