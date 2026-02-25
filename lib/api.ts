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
  TranslationPair,
} from "./types";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Fetch wrapper — provides actionable error messages for network failures
// ---------------------------------------------------------------------------

async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(
        `Cannot reach the backend at ${BACKEND_URL}. ` +
        "Ensure the backend is running and CORS_ORIGINS is configured to allow your frontend URL."
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /v1/parse — parse CSV or XLSX on the backend, return normalized rows
// ---------------------------------------------------------------------------

export async function parseFile(file: File): Promise<TranslationPair[]> {
  const form = new FormData();
  form.append("file", file);

  const resp = await safeFetch(`${BACKEND_URL}/v1/parse`, {
    method: "POST",
    body: form,
  });

  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(detail.detail || `Backend error: ${resp.status}`);
  }

  const data: { rows: TranslationPair[] } = await resp.json();
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
  },
): Promise<JobCreated> {
  const form = new FormData();
  form.append("file", csvFile);
  form.append("model", config.model);
  form.append("system_prompt", config.systemPrompt);
  form.append("temperature", String(config.temperature));
  form.append("max_tokens", String(config.maxTokens));
  form.append("compute_bertscore", String(config.computeBertscore ?? false));

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
// GET /v1/jobs/{job_id} — poll status
// ---------------------------------------------------------------------------

export async function pollJobStatus(jobId: string): Promise<JobStatusResponse> {
  const resp = await safeFetch(`${BACKEND_URL}/v1/jobs/${jobId}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch job status: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id}/results — full results
// ---------------------------------------------------------------------------

export async function fetchJobResults(jobId: string): Promise<JobResults> {
  const resp = await safeFetch(`${BACKEND_URL}/v1/jobs/${jobId}/results`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch results: ${resp.status}`);
  }
  return resp.json();
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
// Polling helper — polls until complete/failed/cancelled, calling onStatus each tick
// ---------------------------------------------------------------------------

export async function pollUntilDone(
  jobId: string,
  onStatus: (status: JobStatusResponse) => void,
  intervalMs: number = 2000,
  signal?: AbortSignal,
): Promise<JobResults> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      return fetchJobResults(jobId);
    }

    const status = await pollJobStatus(jobId);
    onStatus(status);

    if (status.status === "complete" || status.status === "failed" || status.status === "cancelled") {
      return fetchJobResults(jobId);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
