import type { TranslationPair, TranslationResult } from "@/lib/types";

const STORAGE_KEYS = {
  data: "medtranslate:data",
  prompt: "medtranslate:prompt",
  rowLimit: "medtranslate:rowLimit",
  results: "medtranslate:results",
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

// Results
export function getSessionResults() {
  return readJSON<TranslationResult[]>(STORAGE_KEYS.results);
}

export function setSessionResults(results: TranslationResult[] | undefined) {
  writeJSON(STORAGE_KEYS.results, results);
}

export function clearSessionState() {
  setSessionData(undefined);
  setSessionPrompt(undefined);
  setSessionRowLimit(undefined);
  setSessionResults(undefined);
}