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
  if (typeof window === "undefined") return false;
  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    // Accessing localStorage can throw when storage is blocked by the browser.
    return false;
  }
}

function readJSON<T>(key: string): T | undefined {
  if (!canUseStorage()) return undefined;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return undefined;
  }
}

/** Write JSON to localStorage. Returns true only when the value was stored. */
function writeJSON<T>(key: string, value: T | undefined): boolean {
  if (!canUseStorage()) return false;
  try {
    if (value == null) {
      localStorage.removeItem(key);
      return true;
    }
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage blocked — caller decides on a fallback.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dataset (uploaded translation pairs)
//
// Storage strategy, in order of preference:
//   1. IndexedDB — handles large datasets; localStorage then holds only a
//      small presence flag { _idb: true, length }.
//   2. localStorage — full copy, used when IndexedDB is unavailable (private
//      browsing, blocked storage, a hung `indexedDB.open`) and the dataset
//      fits within the quota.
//   3. In-memory — always kept for the lifetime of the page so client-side
//      navigation between Upload → Translate never loses the dataset even if
//      both persistent stores fail.
// ---------------------------------------------------------------------------

interface SessionDataPresenceFlag {
  _idb: true;
  length: number;
}

let memorySessionData: TranslationPair[] | undefined;

function isPresenceFlag(value: unknown): value is SessionDataPresenceFlag {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { _idb?: unknown })._idb === true
  );
}

/** Sync getter — localStorage only. Returns the full array when one is stored there. */
export function getSessionData(): TranslationPair[] | undefined {
  const fromLS = readJSON<unknown>(STORAGE_KEYS.data);
  return Array.isArray(fromLS) ? (fromLS as TranslationPair[]) : undefined;
}

/**
 * Sync setter — localStorage + in-memory only. Prefer setSessionDataAsync(),
 * which also persists to IndexedDB for large datasets.
 */
export function setSessionData(data: TranslationPair[] | undefined) {
  memorySessionData = data;
  writeJSON(STORAGE_KEYS.data, data);
}

/**
 * Async getter. Resolves the uploaded dataset from whichever store holds it:
 * a full localStorage copy, then IndexedDB, then the in-memory copy.
 */
export async function getSessionDataAsync(): Promise<TranslationPair[] | undefined> {
  // A full array in localStorage means the most recent save could not reach
  // IndexedDB, so it is authoritative over whatever (possibly stale) data IDB
  // still holds.
  const fromLS = readJSON<unknown>(STORAGE_KEYS.data);
  if (Array.isArray(fromLS)) {
    memorySessionData = fromLS as TranslationPair[];
    return memorySessionData;
  }

  const fromIDB = await getSessionDataIDB();
  if (Array.isArray(fromIDB)) {
    memorySessionData = fromIDB;
    return fromIDB;
  }

  // Presence flag without readable IDB data, or nothing persisted at all:
  // fall back to the copy kept in memory for this page lifetime.
  return memorySessionData;
}

/**
 * Async setter. Writes to IndexedDB and, only if that succeeds, replaces the
 * localStorage copy with a lightweight presence flag. If IndexedDB fails the
 * full dataset is written to localStorage instead, so the data is never
 * reduced to a flag that points at nothing. The in-memory copy is always kept.
 */
export async function setSessionDataAsync(data: TranslationPair[] | undefined): Promise<void> {
  memorySessionData = data;

  if (data == null) {
    writeJSON(STORAGE_KEYS.data, undefined);
    await setSessionDataIDB(undefined);
    return;
  }

  const storedInIDB = await setSessionDataIDB(data);
  if (storedInIDB) {
    const flag: SessionDataPresenceFlag = { _idb: true, length: data.length };
    writeJSON(STORAGE_KEYS.data, flag);
    return;
  }

  // IndexedDB unavailable or write failed. Clear any previous value first so a
  // quota failure below cannot leave a stale array or a dangling flag behind.
  writeJSON(STORAGE_KEYS.data, undefined);
  writeJSON(STORAGE_KEYS.data, data);
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
  memorySessionData = undefined;
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
