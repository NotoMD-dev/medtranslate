/**
 * Backend API client for MedTranslate.
 *
 * All translation and metric computation requests go through these
 * functions to the FastAPI backend.  The frontend never calls OpenAI
 * directly and never computes metrics.
 */

import type {
  JobCreated,
  JobResults,
  JobStatusResponse,
} from "./types";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

const RESULTS_PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  const finalInit: RequestInit = {
    cache: "no-store",
    ...init,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      ...(init?.headers || {}),
    },
  };

  try {
    return await fetch(input, finalInit);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(
        `Cannot reach the backend. ` +
        "Ensure the FastAPI backend is running (e.g. uvicorn app.main:app --port 8000) " +
        "and the BACKEND_URL environment variable is set correctly."
      );
    }
    throw err;
  }
}

/**
 * Fetch with automatic retry on transient errors (5xx, network failures).
 * Uses exponential backoff: 1.5s, 3s, 6s.
 */
async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await safeFetch(input, init);
      if (resp.ok || resp.status < 500) return resp;

      // Server error — retry
      lastError = new Error(`Server error: ${resp.status}`);
    } catch (err) {
      lastError = err as Error;
    }

    if (attempt < retries - 1) {
      await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// POST /v1/parse — parse CSV or XLSX on the backend, return normalized rows
// ---------------------------------------------------------------------------

export async function parseFile(
  file: File,
  sourceColumn?: string,
): Promise<import("./types").TranslationPair[]> {
  const form = new FormData();
  form.append("file", file);
  if (sourceColumn) form.append("source_column", sourceColumn);

  const resp = await safeFetch(`${BACKEND_URL}/v1/parse`, {
    method: "POST",
    body: form,
  });

  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(detail.detail || `Backend error: ${resp.status}`);
  }

  const data: { rows: import("./types").TranslationPair[] } = await resp.json();
  return data.rows;
}

// ---------------------------------------------------------------------------
// POST /v1/jobs — submit CSV or XLSX + config
// ---------------------------------------------------------------------------

export async function submitJob(
  csvFile: File,
  config: {
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    computeBertscore?: boolean;
    metricsOnly?: boolean;
  },
): Promise<JobCreated> {
  const form = new FormData();
  form.append("file", csvFile);
  form.append("model", config.model);
  form.append("system_prompt", config.systemPrompt);
  form.append("temperature", String(config.temperature));
  form.append("max_tokens", String(config.maxTokens));
  form.append("compute_bertscore", String(config.computeBertscore ?? false));
  form.append("metrics_only", String(config.metricsOnly ?? false));

  const resp = await safeFetch(`${BACKEND_URL}/v1/jobs`, {
    method: "POST",
    body: form,
  });

  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(detail.detail || `Backend error: ${resp.status}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id} — poll status (with retry)
// ---------------------------------------------------------------------------

export async function pollJobStatus(jobId: string): Promise<JobStatusResponse> {
  const resp = await fetchWithRetry(`${BACKEND_URL}/v1/jobs/${jobId}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch job status: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id}/results — paginated results (with retry)
// ---------------------------------------------------------------------------

export async function fetchJobResults(
  jobId: string,
  offset: number = 0,
  limit: number = 0,
): Promise<JobResults> {
  const params = new URLSearchParams();
  if (offset > 0) params.set("offset", String(offset));
  if (limit > 0) params.set("limit", String(limit));
  const qs = params.toString();
  const url = `${BACKEND_URL}/v1/jobs/${jobId}/results${qs ? `?${qs}` : ""}`;

  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch results: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Fetch all job results via sequential paginated requests.
 * Each page retries individually on failure for maximum resilience.
 */
export async function fetchAllJobResultsPaginated(
  jobId: string,
): Promise<JobResults> {
  const firstPage = await fetchJobResults(jobId, 0, RESULTS_PAGE_SIZE);
  const total = firstPage.total ?? firstPage.sentence_metrics.length;

  if (total <= RESULTS_PAGE_SIZE) return firstPage;

  // Fetch remaining pages sequentially to avoid overwhelming the backend.
  // Each individual page already has retry logic via fetchWithRetry.
  const allMetrics = [...firstPage.sentence_metrics];

  for (let off = RESULTS_PAGE_SIZE; off < total; off += RESULTS_PAGE_SIZE) {
    const page = await fetchJobResults(jobId, off, RESULTS_PAGE_SIZE);
    allMetrics.push(...page.sentence_metrics);
  }

  return { ...firstPage, sentence_metrics: allMetrics, offset: 0, total };
}

// ---------------------------------------------------------------------------
// POST /v1/jobs/{job_id}/cancel — cancel a running job
// ---------------------------------------------------------------------------

export async function cancelJob(jobId: string): Promise<void> {
  const resp = await safeFetch(`${BACKEND_URL}/v1/jobs/${jobId}/cancel`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Failed to cancel job: ${resp.status}`);
  }
}

// ---------------------------------------------------------------------------
// Polling helper — polls until complete/failed/cancelled
// ---------------------------------------------------------------------------

export async function pollUntilDone(
  jobId: string,
  onStatus: (status: JobStatusResponse) => void | Promise<void>,
  intervalMs: number = 2000,
  signal?: AbortSignal,
): Promise<JobResults> {
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  while (true) {
    if (signal?.aborted) {
      return fetchAllJobResultsPaginated(jobId);
    }

    try {
      const status = await pollJobStatus(jobId);
      consecutiveErrors = 0; // reset on success

      // Await the callback so it completes before the next poll tick,
      // preventing concurrent partial-result fetches from piling up.
      await onStatus(status);

      if (
        status.status === "complete" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        // Break out of the polling loop so the results fetch happens *outside*
        // this try/catch.  If fetchAllJobResultsPaginated were called here and
        // threw, the catch block would reset consecutiveErrors to 0 on the very
        // next successful pollJobStatus, making MAX_CONSECUTIVE_ERRORS
        // unreachable and causing the loop to spin forever in "running" state.
        break;
      }
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Too many consecutive failures — the backend is likely unreachable.
        // Try one final fetch in case the job already completed.
        try {
          return await fetchAllJobResultsPaginated(jobId);
        } catch {
          throw new Error(
            `Lost connection to the backend after ${MAX_CONSECUTIVE_ERRORS} consecutive poll failures. ` +
            "The job may still be running on the server. Refresh the page to check."
          );
        }
      }
      // Transient error — back off and retry on the next tick
    }

    await sleep(intervalMs);
  }

  // Job has reached a terminal state.  Fetch results outside the error-tracking
  // try/catch so any failure propagates directly to the caller instead of
  // silently re-entering the polling loop.
  return fetchAllJobResultsPaginated(jobId);
}
