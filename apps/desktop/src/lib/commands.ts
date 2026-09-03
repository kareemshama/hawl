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

export const storeStatus = () => invoke<StoreStatus>("store_status");
export const storeCreate = (passphrase: string, profile: unknown) => invoke<void>("store_create", { passphrase, profile });
export const storeUnlock = (passphrase: string) => invoke<unknown>("store_unlock", { passphrase });
export const storeSave = (profile: unknown) => invoke<void>("store_save", { profile });
export const storeLock = () => invoke<void>("store_lock");
export const storeChangePassphrase = (current: string, next: string) => invoke<void>("store_change_passphrase", { current, next });

export const fetchPrices = (currency: string) => invoke<MetalPrices>("fetch_prices", { currency });

export const hijriFromGregorian = (date: string, adjust: number) => invoke<HijriDate>("hijri_from_gregorian", { date, adjust });
export const hijriToGregorian = (year: number, month: number, day: number, adjust: number) =>
  invoke<HijriDate>("hijri_to_gregorian", { year, month, day, adjust });
export const hijriNextOccurrence = (month: number, day: number, from: string, adjust: number) =>
  invoke<HijriDate>("hijri_next_occurrence", { month, day, from, adjust });
export const hijriPreviousOccurrence = (month: number, day: number, from: string, adjust: number) =>
  invoke<HijriDate>("hijri_previous_occurrence", { month, day, from, adjust });

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
