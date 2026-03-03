import type { TranslationPair, JobResults, ClinicalGrade, ReferenceFlag } from "@/lib/types";
import { getJobResultsIDB, setJobResultsIDB, getGradesIDB, setGradesIDB, getRefFlagsIDB, setRefFlagsIDB, getSessionDataIDB, setSessionDataIDB, getComparisonResultsIDB, setComparisonResultsIDB } from "@/lib/idb";

const STORAGE_KEYS = {
  data: "medtranslate:data",
  prompt: "medtranslate:prompt",
  rowLimit: "medtranslate:rowLimit",
  jobId: "medtranslate:jobId",
  jobResults: "medtranslate:jobResults",
  grades: "medtranslate:grades",
  referenceFlags: "medtranslate:referenceFlags",
  csvFile: "medtranslate:csvFile",
  model: "medtranslate:model",
  sourceLanguage: "medtranslate:sourceLanguage",
  comparisonResults: "medtranslate:comparisonResults",
} as const;

function canUseStorage() {
  return typeof window !== "undefined";
}

function readJSON<T>(key: string): T | undefined {
  if (!canUseStorage()) return undefined;
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return undefined;
  }
}

function writeJSON<T>(key: string, value: T | undefined) {
  if (!canUseStorage()) return;
  if (value == null) {
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded — data lives in component state; IndexedDB handles large payloads.
  }
}

// Data
export function getSessionData() {
  return readJSON<TranslationPair[]>(STORAGE_KEYS.data);
}

export function setSessionData(data: TranslationPair[] | undefined) {
  writeJSON(STORAGE_KEYS.data, data);
}

// Async getter — tries IndexedDB first, falls back to localStorage.
export async function getSessionDataAsync(): Promise<TranslationPair[] | undefined> {
  const fromIDB = await getSessionDataIDB();
  if (fromIDB) return fromIDB;
  // localStorage may contain full data (small datasets written by the sync
  // setter) or a lightweight presence flag written by setSessionDataAsync.
  // Only return actual arrays — ignore presence flags.
  const fromLS = getSessionData();
  if (Array.isArray(fromLS)) return fromLS;
  return undefined;
}

// Async setter — writes to IndexedDB (large-data safe) and a lightweight
// presence flag to localStorage (avoids wasteful full-data writes that would
// silently fail on quota-exceeded for large datasets).
export async function setSessionDataAsync(data: TranslationPair[] | undefined): Promise<void> {
  await setSessionDataIDB(data);
  writeJSON(STORAGE_KEYS.data, data ? { _idb: true, length: data.length } : undefined);
}

// Prompt
export function getSessionPrompt() {
  return readJSON<string>(STORAGE_KEYS.prompt);
}

export function setSessionPrompt(prompt: string | undefined) {
  writeJSON(STORAGE_KEYS.prompt, prompt);
}

// Row limit
export function getSessionRowLimit() {
  return readJSON<number>(STORAGE_KEYS.rowLimit);
}

export function setSessionRowLimit(rowLimit: number | undefined) {
  writeJSON(STORAGE_KEYS.rowLimit, rowLimit);
}

// Job ID
export function getSessionJobId() {
  return readJSON<string>(STORAGE_KEYS.jobId);
}

export function setSessionJobId(jobId: string | undefined) {
  writeJSON(STORAGE_KEYS.jobId, jobId);
}

// Job Results (from backend)
// Sync version — reads from localStorage only (used as fast initial check).
export function getSessionJobResults() {
  return readJSON<JobResults>(STORAGE_KEYS.jobResults);
}

// Sync setter — tries localStorage but silently ignores quota errors.
// Callers should prefer setSessionJobResultsAsync() for reliable persistence.
export function setSessionJobResults(results: JobResults | undefined) {
  if (!canUseStorage()) return;
  if (results == null) {
    localStorage.removeItem(STORAGE_KEYS.jobResults);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEYS.jobResults, JSON.stringify(results));
  } catch {
    // Quota exceeded — IndexedDB write handled by async variant.
  }
}

// Async getter — tries IndexedDB first, falls back to localStorage.
export async function getSessionJobResultsAsync(): Promise<JobResults | undefined> {
  const fromIDB = await getJobResultsIDB();
  if (fromIDB) return fromIDB;
  return getSessionJobResults();
}

// Async setter — writes to IndexedDB (large-data safe) and attempts localStorage.
export async function setSessionJobResultsAsync(results: JobResults | undefined): Promise<void> {
  await setJobResultsIDB(results);
  setSessionJobResults(results);
}

// Clinical grades (client-side grading persisted separately)
export function getSessionGrades() {
  return readJSON<Record<string, ClinicalGrade>>(STORAGE_KEYS.grades);
}

export function setSessionGrades(grades: Record<string, ClinicalGrade> | undefined) {
  try {
    writeJSON(STORAGE_KEYS.grades, grades);
  } catch {
    // Quota exceeded — IndexedDB write handled by async variant.
  }
}

// Async getter — tries IndexedDB first, falls back to localStorage.
export async function getSessionGradesAsync(): Promise<Record<string, ClinicalGrade> | undefined> {
  const fromIDB = await getGradesIDB();
  if (fromIDB) return fromIDB;
  return getSessionGrades();
}

// Async setter — writes to IndexedDB (large-data safe) and attempts localStorage.
export async function setSessionGradesAsync(grades: Record<string, ClinicalGrade> | undefined): Promise<void> {
  await setGradesIDB(grades);
  setSessionGrades(grades);
}

// Reference quality flags (reviewer flags gold-standard issues)
export function getSessionRefFlags() {
  return readJSON<Record<string, ReferenceFlag>>(STORAGE_KEYS.referenceFlags);
}

export function setSessionRefFlags(flags: Record<string, ReferenceFlag> | undefined) {
  try {
    writeJSON(STORAGE_KEYS.referenceFlags, flags);
  } catch {
    // Quota exceeded — IndexedDB write handled by async variant.
  }
}

export async function getSessionRefFlagsAsync(): Promise<Record<string, ReferenceFlag> | undefined> {
  const fromIDB = await getRefFlagsIDB();
  if (fromIDB) return fromIDB;
  return getSessionRefFlags();
}

export async function setSessionRefFlagsAsync(flags: Record<string, ReferenceFlag> | undefined): Promise<void> {
  await setRefFlagsIDB(flags);
  setSessionRefFlags(flags);
}

// CSV file name (for display only)
export function getSessionCsvFileName() {
  if (!canUseStorage()) return undefined;
  return localStorage.getItem(STORAGE_KEYS.csvFile) || undefined;
}

export function setSessionCsvFileName(name: string | undefined) {
  if (!canUseStorage()) return;
  if (name == null) {
    localStorage.removeItem(STORAGE_KEYS.csvFile);
  } else {
    localStorage.setItem(STORAGE_KEYS.csvFile, name);
  }
}

// Model
export function getSessionModel() {
  if (!canUseStorage()) return undefined;
  return localStorage.getItem(STORAGE_KEYS.model) || undefined;
}

export function setSessionModel(model: string | undefined) {
  if (!canUseStorage()) return;
  if (model == null) {
    localStorage.removeItem(STORAGE_KEYS.model);
  } else {
    localStorage.setItem(STORAGE_KEYS.model, model);
  }
}

// Source language
export function getSessionSourceLanguage() {
  if (!canUseStorage()) return undefined;
  return localStorage.getItem(STORAGE_KEYS.sourceLanguage) || undefined;
}

export function setSessionSourceLanguage(lang: string | undefined) {
  if (!canUseStorage()) return;
  if (lang == null) {
    localStorage.removeItem(STORAGE_KEYS.sourceLanguage);
  } else {
    localStorage.setItem(STORAGE_KEYS.sourceLanguage, lang);
  }
}

// Comparison results (stores results keyed by model id for head-to-head)
export function getSessionComparisonResults() {
  return readJSON<Record<string, import("@/lib/types").JobResults>>(STORAGE_KEYS.comparisonResults);
}

export function setSessionComparisonResults(results: Record<string, import("@/lib/types").JobResults> | undefined) {
  writeJSON(STORAGE_KEYS.comparisonResults, results);
}

export async function getSessionComparisonResultsAsync(): Promise<Record<string, import("@/lib/types").JobResults> | undefined> {
  const fromIDB = await getComparisonResultsIDB();
  if (fromIDB) return fromIDB;
  return getSessionComparisonResults();
}

export async function setSessionComparisonResultsAsync(
  results: Record<string, import("@/lib/types").JobResults> | undefined,
): Promise<void> {
  await setComparisonResultsIDB(results);
  setSessionComparisonResults(results);
}

export function clearSessionState() {
  setSessionData(undefined);
  setSessionPrompt(undefined);
  setSessionRowLimit(undefined);
  setSessionJobId(undefined);
  setSessionJobResults(undefined);
  setSessionGrades(undefined);
  setSessionRefFlags(undefined);
  setSessionCsvFileName(undefined);
  setSessionModel(undefined);
  setSessionSourceLanguage(undefined);
  setSessionComparisonResults(undefined);
  // Also clear IndexedDB (fire-and-forget)
  setJobResultsIDB(undefined).catch(() => {});
  setGradesIDB(undefined).catch(() => {});
  setRefFlagsIDB(undefined).catch(() => {});
  setSessionDataIDB(undefined).catch(() => {});
  setComparisonResultsIDB(undefined).catch(() => {});
}
