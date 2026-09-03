import { invoke } from "@tauri-apps/api/core";
import type { MetalPrices } from "@hawl/core-types";

export interface StoreStatus {
  exists: boolean;
  unlocked: boolean;
  path: string;
}

export interface HijriDate {
  year: number;
  month: number;
  day: number;
  monthName: string;
  label: string;
  gregorian: string;
}

export const HIJRI_MONTHS = [
  "Muharram",
  "Safar",
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  "Jumada al-Ula",
  "Jumada al-Akhirah",
  "Rajab",
  "Sha'ban",
  "Ramadan",
  "Shawwal",
  "Dhu al-Qa'dah",
  "Dhu al-Hijjah",
] as const;

/** True inside the Tauri webview. In a plain browser the mock backend is used instead. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Backend = {
  storeStatus: () => Promise<StoreStatus>;
  storeCreate: (passphrase: string, profile: unknown) => Promise<void>;
  storeUnlock: (passphrase: string) => Promise<unknown>;
  storeSave: (profile: unknown) => Promise<void>;
  storeLock: () => Promise<void>;
  storeChangePassphrase: (current: string, next: string) => Promise<void>;
  fetchPrices: (currency: string) => Promise<MetalPrices>;
  hijriFromGregorian: (date: string, adjust: number) => Promise<HijriDate>;
  hijriToGregorian: (year: number, month: number, day: number, adjust: number) => Promise<HijriDate>;
  hijriNextOccurrence: (month: number, day: number, from: string, adjust: number) => Promise<HijriDate>;
  hijriPreviousOccurrence: (month: number, day: number, from: string, adjust: number) => Promise<HijriDate>;
};

const tauri: Backend = {
  storeStatus: () => invoke<StoreStatus>("store_status"),
  storeCreate: (passphrase, profile) => invoke<void>("store_create", { passphrase, profile }),
  storeUnlock: (passphrase) => invoke<unknown>("store_unlock", { passphrase }),
  storeSave: (profile) => invoke<void>("store_save", { profile }),
  storeLock: () => invoke<void>("store_lock"),
  storeChangePassphrase: (current, next) => invoke<void>("store_change_passphrase", { current, next }),
  fetchPrices: (currency) => invoke<MetalPrices>("fetch_prices", { currency }),
  hijriFromGregorian: (date, adjust) => invoke<HijriDate>("hijri_from_gregorian", { date, adjust }),
  hijriToGregorian: (year, month, day, adjust) => invoke<HijriDate>("hijri_to_gregorian", { year, month, day, adjust }),
  hijriNextOccurrence: (month, day, from, adjust) => invoke<HijriDate>("hijri_next_occurrence", { month, day, from, adjust }),
  hijriPreviousOccurrence: (month, day, from, adjust) => invoke<HijriDate>("hijri_previous_occurrence", { month, day, from, adjust }),
};

let backend: Backend = tauri;
if (!isTauri) {
  // Loaded lazily so the mock never ships in the Tauri bundle's hot path.
  const { mock } = await import("./mock");
  backend = mock;
}

export const storeStatus = () => backend.storeStatus();
export const storeCreate = (passphrase: string, profile: unknown) => backend.storeCreate(passphrase, profile);
export const storeUnlock = (passphrase: string) => backend.storeUnlock(passphrase);
export const storeSave = (profile: unknown) => backend.storeSave(profile);
export const storeLock = () => backend.storeLock();
export const storeChangePassphrase = (current: string, next: string) => backend.storeChangePassphrase(current, next);
export const fetchPrices = (currency: string) => backend.fetchPrices(currency);
export const hijriFromGregorian = (date: string, adjust: number) => backend.hijriFromGregorian(date, adjust);
export const hijriToGregorian = (year: number, month: number, day: number, adjust: number) => backend.hijriToGregorian(year, month, day, adjust);
export const hijriNextOccurrence = (month: number, day: number, from: string, adjust: number) => backend.hijriNextOccurrence(month, day, from, adjust);
export const hijriPreviousOccurrence = (month: number, day: number, from: string, adjust: number) => backend.hijriPreviousOccurrence(month, day, from, adjust);

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
