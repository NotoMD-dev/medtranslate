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
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// POST /v1/jobs — submit CSV + config
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

  const resp = await fetch(`${BACKEND_URL}/v1/jobs`, {
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
  const resp = await fetch(`${BACKEND_URL}/v1/jobs/${jobId}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch job status: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id}/results — full results
// ---------------------------------------------------------------------------

export async function fetchJobResults(jobId: string): Promise<JobResults> {
  const resp = await fetch(`${BACKEND_URL}/v1/jobs/${jobId}/results`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch results: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Polling helper — polls until complete/failed, calling onStatus each tick
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
      throw new DOMException("Translation stopped by user", "AbortError");
    }

    const status = await pollJobStatus(jobId);
    onStatus(status);

    if (status.status === "complete" || status.status === "failed") {
      return fetchJobResults(jobId);
    }

    if (signal?.aborted) {
      throw new DOMException("Translation stopped by user", "AbortError");
    }

    await new Promise((r) => {
      const timer = setTimeout(r, intervalMs);
      signal?.addEventListener("abort", () => { clearTimeout(timer); r(undefined); }, { once: true });
    });
  }
}
