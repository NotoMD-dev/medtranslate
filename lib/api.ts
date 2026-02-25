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

function normalizeBase(url: string) {
  return url.replace(/\/+$/, "");
}

function unique<T>(arr: T[]) {
  return [...new Set(arr)];
}

function endpointCandidates(path: string) {
  const safePath = path.replace(/^\/+/, "");
  const base = normalizeBase(BACKEND_URL);
  const baseVariants = unique([base, base.replace(/\/v1$/, "")]);

  const urls: string[] = [];
  for (const b of baseVariants) {
    urls.push(`${b}/v1/${safePath}`);
    urls.push(`${b}/${safePath}`);
  }

  return unique(urls);
}

async function readErrorDetail(resp: Response) {
  const data = await resp.json().catch(() => null);
  if (data && typeof data === "object" && "detail" in data) {
    return String((data as { detail: unknown }).detail);
  }
  return `Backend error: ${resp.status}`;
}

async function fetchJsonWithFallback<T>(
  path: string,
  init: RequestInit,
  options?: { retryOn400?: boolean },
): Promise<T> {
  const urls = endpointCandidates(path);
  let lastError: string | null = null;

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const resp = await fetch(url, init);

      if (resp.ok) {
        return (await resp.json()) as T;
      }

      const detail = await readErrorDetail(resp);
      lastError = `${detail} (URL: ${url})`;

      if (resp.status === 404) {
        continue;
      }

      if (resp.status === 400 && options?.retryOn400) {
        continue;
      }

      throw new Error(lastError);
    } catch (err) {
      if (err instanceof Error && /Failed to fetch/i.test(err.message)) {
        lastError = `Failed to fetch backend at ${url}. Check NEXT_PUBLIC_BACKEND_URL and CORS settings.`;
        continue;
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }
  }

  throw new Error(lastError || "Failed to reach backend API.");
}

async function fetchWithFallback(
  path: string,
  init: RequestInit,
): Promise<void> {
  const urls = endpointCandidates(path);
  let lastError: string | null = null;

  for (const url of urls) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) return;

      const detail = await readErrorDetail(resp);
      lastError = `${detail} (URL: ${url})`;
      if (resp.status === 404) continue;
      throw new Error(lastError);
    } catch (err) {
      if (err instanceof Error && /Failed to fetch/i.test(err.message)) {
        lastError = `Failed to fetch backend at ${url}. Check NEXT_PUBLIC_BACKEND_URL and CORS settings.`;
        continue;
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }
  }

  throw new Error(lastError || "Failed to reach backend API.");
}

// ---------------------------------------------------------------------------
// POST /v1/parse — parse CSV or XLSX on the backend, return normalized rows
// ---------------------------------------------------------------------------

export async function parseFile(file: File): Promise<TranslationPair[]> {
  const form = new FormData();
  form.append("file", file);

  const data = await fetchJsonWithFallback<{ rows: TranslationPair[] }>(
    "parse",
    { method: "POST", body: form },
  );

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

  return fetchJsonWithFallback<JobCreated>(
    "jobs",
    { method: "POST", body: form },
    { retryOn400: true },
  );
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id} — poll status
// ---------------------------------------------------------------------------

export async function pollJobStatus(jobId: string): Promise<JobStatusResponse> {
  return fetchJsonWithFallback<JobStatusResponse>(`jobs/${jobId}`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// GET /v1/jobs/{job_id}/results — full results
// ---------------------------------------------------------------------------

export async function fetchJobResults(jobId: string): Promise<JobResults> {
  return fetchJsonWithFallback<JobResults>(`jobs/${jobId}/results`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// POST /v1/jobs/{job_id}/cancel — cancel a running job
// ---------------------------------------------------------------------------

export async function cancelJob(jobId: string): Promise<void> {
  await fetchWithFallback(`jobs/${jobId}/cancel`, {
    method: "POST",
  });
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
