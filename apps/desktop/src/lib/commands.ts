import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MetalPrices } from "@hawl/core-types";

export interface StoreStatus {
  exists: boolean;
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

export interface AiStatus {
  engineReady: boolean;
  modelReady: boolean;
  modelLabel: string;
  gpuDetected: boolean;
  cudaBuild: boolean;
  usingGpu: boolean;
  running: boolean;
}

export interface DownloadProgress {
  stage: string;
  downloaded: number;
  total: number;
  percent: number;
}

export interface AiRow {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  /** Heading the row was printed under, as printed; "" when none. */
  section?: string;
}

export interface AiPage {
  rows: AiRow[];
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
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

export type Backend = {
  storeStatus: () => Promise<StoreStatus>;
  /** The saved profile, or null when nothing has been saved yet. */
  storeLoad: () => Promise<unknown | null>;
  storeSave: (profile: unknown) => Promise<void>;
  storeDelete: () => Promise<void>;
  aiStatus: () => Promise<AiStatus>;
  aiSetup: () => Promise<AiStatus>;
  aiExtractPage: (text: string, periodStart: string | null, periodEnd: string | null, previousSection: string | null, currency: string) => Promise<AiPage>;
  aiSetGpu: (enabled: boolean) => Promise<void>;
  onAiProgress: (cb: (p: DownloadProgress) => void) => Promise<UnlistenFn>;
  fetchPrices: (currency: string) => Promise<MetalPrices>;
  hijriFromGregorian: (date: string, adjust: number) => Promise<HijriDate>;
  hijriToGregorian: (year: number, month: number, day: number, adjust: number) => Promise<HijriDate>;
  hijriNextOccurrence: (month: number, day: number, from: string, adjust: number) => Promise<HijriDate>;
  hijriPreviousOccurrence: (month: number, day: number, from: string, adjust: number) => Promise<HijriDate>;
};

const tauri: Backend = {
  storeStatus: () => invoke<StoreStatus>("store_status"),
  storeLoad: () => invoke<unknown | null>("store_load"),
  storeSave: (profile) => invoke<void>("store_save", { profile }),
  storeDelete: () => invoke<void>("store_delete"),
  aiStatus: () => invoke<AiStatus>("ai_status"),
  aiSetup: () => invoke<AiStatus>("ai_setup"),
  aiExtractPage: (text, periodStart, periodEnd, previousSection, currency) => invoke<AiPage>("ai_extract_page", { text, periodStart, periodEnd, previousSection, currency }),
  aiSetGpu: (enabled) => invoke<void>("ai_set_gpu", { enabled }),
  onAiProgress: (cb) => listen<DownloadProgress>("ai-download-progress", (e) => cb(e.payload)),
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
export const storeLoad = () => backend.storeLoad();
export const storeSave = (profile: unknown) => backend.storeSave(profile);
export const storeDelete = () => backend.storeDelete();
export const aiStatus = () => backend.aiStatus();
export const aiSetup = () => backend.aiSetup();
export const aiExtractPage = (text: string, periodStart: string | null, periodEnd: string | null, previousSection: string | null, currency: string) => backend.aiExtractPage(text, periodStart, periodEnd, previousSection, currency);
export const aiSetGpu = (enabled: boolean) => backend.aiSetGpu(enabled);
export const onAiProgress = (cb: (p: DownloadProgress) => void) => backend.onAiProgress(cb);
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
