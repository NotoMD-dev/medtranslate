import type { TranslationPair, JobResults, ClinicalGrade } from "@/lib/types";

const STORAGE_KEYS = {
  data: "medtranslate:data",
  prompt: "medtranslate:prompt",
  rowLimit: "medtranslate:rowLimit",
  jobId: "medtranslate:jobId",
  jobResults: "medtranslate:jobResults",
  grades: "medtranslate:grades",
  csvFile: "medtranslate:csvFile",
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
  localStorage.setItem(key, JSON.stringify(value));
}

// Data
export function getSessionData() {
  return readJSON<TranslationPair[]>(STORAGE_KEYS.data);
}

export function setSessionData(data: TranslationPair[] | undefined) {
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
export function getSessionJobResults() {
  return readJSON<JobResults>(STORAGE_KEYS.jobResults);
}

export function setSessionJobResults(results: JobResults | undefined) {
  writeJSON(STORAGE_KEYS.jobResults, results);
}

// Clinical grades (client-side grading persisted separately)
export function getSessionGrades() {
  return readJSON<Record<string, ClinicalGrade>>(STORAGE_KEYS.grades);
}

export function setSessionGrades(grades: Record<string, ClinicalGrade> | undefined) {
  writeJSON(STORAGE_KEYS.grades, grades);
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

export function clearSessionState() {
  setSessionData(undefined);
  setSessionPrompt(undefined);
  setSessionRowLimit(undefined);
  setSessionJobId(undefined);
  setSessionJobResults(undefined);
  setSessionGrades(undefined);
  setSessionCsvFileName(undefined);
}
