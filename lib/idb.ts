/**
 * IndexedDB storage for large objects that exceed localStorage's ~5 MB quota.
 *
 * Used for the uploaded dataset and for `jobResults`, which can grow very
 * large with thousands of sentence-level metrics (clinical text pairs).
 *
 * Every helper here is failure-tolerant: getters resolve to `undefined` and
 * setters resolve to `false` when IndexedDB is unavailable, blocked, throws,
 * or never answers (a known WebKit bug where `indexedDB.open` hangs). Callers
 * use the boolean result to decide whether a fallback copy is needed.
 */

import type { JobResults, ClinicalGrade, ReferenceFlag, TranslationPair } from "@/lib/types";

const DB_NAME = "medtranslate";
const DB_VERSION = 1;
const STORE_NAME = "session";
const JOB_RESULTS_KEY = "jobResults";
const GRADES_KEY = "grades";
const REF_FLAGS_KEY = "referenceFlags";
const SESSION_DATA_KEY = "sessionData";
const COMPARISON_RESULTS_KEY = "comparisonResults";

/** How long to wait for `indexedDB.open` before treating IDB as unavailable. */
const OPEN_TIMEOUT_MS = 5000;

/**
 * Once an open attempt has failed structurally (API missing, throws, or
 * times out) we stop trying for the rest of this page lifetime so each
 * storage call does not pay the timeout again. Reset on reload.
 */
let idbUnavailable = false;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (idbUnavailable) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    if (typeof indexedDB === "undefined") {
      idbUnavailable = true;
      reject(new Error("IndexedDB not supported"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      idbUnavailable = true;
      reject(new Error("IndexedDB open timed out"));
    }, OPEN_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      idbUnavailable = true;
      finish(() => reject(err));
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onerror = () => finish(() => reject(req.error ?? new Error("IndexedDB open failed")));
    req.onblocked = () => finish(() => reject(new Error("IndexedDB open blocked")));
  });
}

/** Read one key from the session store. Never throws; `undefined` on any failure. */
async function idbGet<T>(key: string): Promise<T | undefined> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const conn = db;
    return await new Promise<T | undefined>((resolve) => {
      try {
        const tx = conn.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve((req.result as T | null | undefined) ?? undefined);
        req.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * Write (or delete, when `value` is null/undefined) one key in the session
 * store. Never throws; resolves `true` only when the transaction committed.
 */
async function idbSet(key: string, value: unknown): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const conn = db;
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = conn.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        if (value == null) {
          store.delete(key);
        } else {
          store.put(value, key);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function getJobResultsIDB(): Promise<JobResults | undefined> {
  return idbGet<JobResults>(JOB_RESULTS_KEY);
}

export function setJobResultsIDB(results: JobResults | undefined): Promise<boolean> {
  return idbSet(JOB_RESULTS_KEY, results);
}

export function getGradesIDB(): Promise<Record<string, ClinicalGrade> | undefined> {
  return idbGet<Record<string, ClinicalGrade>>(GRADES_KEY);
}

export function setGradesIDB(grades: Record<string, ClinicalGrade> | undefined): Promise<boolean> {
  return idbSet(GRADES_KEY, grades);
}

export function getRefFlagsIDB(): Promise<Record<string, ReferenceFlag> | undefined> {
  return idbGet<Record<string, ReferenceFlag>>(REF_FLAGS_KEY);
}

export function setRefFlagsIDB(flags: Record<string, ReferenceFlag> | undefined): Promise<boolean> {
  return idbSet(REF_FLAGS_KEY, flags);
}

export function getSessionDataIDB(): Promise<TranslationPair[] | undefined> {
  return idbGet<TranslationPair[]>(SESSION_DATA_KEY);
}

export function setSessionDataIDB(data: TranslationPair[] | undefined): Promise<boolean> {
  return idbSet(SESSION_DATA_KEY, data);
}

export function getComparisonResultsIDB(): Promise<Record<string, JobResults> | undefined> {
  return idbGet<Record<string, JobResults>>(COMPARISON_RESULTS_KEY);
}

export function setComparisonResultsIDB(results: Record<string, JobResults> | undefined): Promise<boolean> {
  return idbSet(COMPARISON_RESULTS_KEY, results);
}
