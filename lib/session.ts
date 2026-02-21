import type { TranslationPair, TranslationResult } from "@/lib/types";

const STORAGE_KEYS = {
  data: "medtranslate:data",
  prompt: "medtranslate:prompt",
  rowLimit: "medtranslate:rowLimit",
  results: "medtranslate:results",
} as const;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJSON<T>(key: string): T | undefined {
  if (!canUseStorage()) return undefined;
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    window.localStorage.removeItem(key);
    return undefined;
  }
}

function writeJSON<T>(key: string, value: T | undefined) {
  if (!canUseStorage()) return;
  if (value == null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getSessionData() {
  return globalThis.__medtranslate_data ?? readJSON<TranslationPair[]>(STORAGE_KEYS.data);
}

export function setSessionData(data: TranslationPair[] | undefined) {
  globalThis.__medtranslate_data = data;
  writeJSON(STORAGE_KEYS.data, data);
}

export function getSessionPrompt() {
  return globalThis.__medtranslate_prompt ?? readJSON<string>(STORAGE_KEYS.prompt);
}

export function setSessionPrompt(prompt: string | undefined) {
  globalThis.__medtranslate_prompt = prompt;
  writeJSON(STORAGE_KEYS.prompt, prompt);
}

export function getSessionRowLimit() {
  return globalThis.__medtranslate_rowLimit ?? readJSON<number>(STORAGE_KEYS.rowLimit);
}

export function setSessionRowLimit(rowLimit: number | undefined) {
  globalThis.__medtranslate_rowLimit = rowLimit;
  writeJSON(STORAGE_KEYS.rowLimit, rowLimit);
}

export function getSessionResults() {
  return (
    globalThis.__medtranslate_results ??
    readJSON<TranslationResult[]>(STORAGE_KEYS.results)
  );
}

export function setSessionResults(results: TranslationResult[] | undefined) {
  globalThis.__medtranslate_results = results;
  writeJSON(STORAGE_KEYS.results, results);
}

export function clearSessionState() {
  setSessionData(undefined);
  setSessionPrompt(undefined);
  setSessionRowLimit(undefined);
  setSessionResults(undefined);
}

declare global {
  // eslint-disable-next-line no-var
  var __medtranslate_data: TranslationPair[] | undefined;
  // eslint-disable-next-line no-var
  var __medtranslate_prompt: string | undefined;
  // eslint-disable-next-line no-var
  var __medtranslate_rowLimit: number | undefined;
  // eslint-disable-next-line no-var
  var __medtranslate_results: TranslationResult[] | undefined;
}
