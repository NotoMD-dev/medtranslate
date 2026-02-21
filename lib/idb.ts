/**
 * IndexedDB storage for large objects that exceed localStorage's ~5 MB quota.
 *
 * Used for `jobResults` which can grow very large with thousands of
 * sentence-level metrics (clinical text pairs).
 */

import type { JobResults } from "@/lib/types";

const DB_NAME = "medtranslate";
const DB_VERSION = 1;
const STORE_NAME = "session";
const JOB_RESULTS_KEY = "jobResults";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getJobResultsIDB(): Promise<JobResults | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(JOB_RESULTS_KEY);
      req.onsuccess = () => resolve(req.result ?? undefined);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return undefined;
  }
}

export async function setJobResultsIDB(
  results: JobResults | undefined,
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      if (results == null) {
        store.delete(JOB_RESULTS_KEY);
      } else {
        store.put(results, JOB_RESULTS_KEY);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // IndexedDB unavailable — silent fallback
  }
}
