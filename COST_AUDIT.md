# Cost-Efficiency & Resource-Risk Audit

**Date:** 2026-03-02
**Scope:** Technical inefficiencies that increase operational costs at scale
**Assumption:** System scales to thousands of users and high-volume AI workloads

---

## 1. API CALL EFFICIENCY

### Issue 1.1: Per-row LLM calls with no deduplication of identical source texts

**Location:** `medtranslate-backend/app/jobs.py:417-431`, `medtranslate-backend/app/translate.py:75-102`

**Why it increases cost:** Every row in the uploaded CSV triggers an independent LLM API call via `translate_text()`. Clinical datasets frequently contain repeated phrases (e.g., common discharge instructions, lab headers, formulaic clinical notes). Each duplicate incurs the full per-token cost of both input and output. A 5,000-row dataset with 15% duplicate source texts wastes ~750 API calls.

**Scaling behavior:** O(n) where n = total rows, but reducible to O(n_unique). Waste grows linearly with dataset size and duplicate frequency.

**Mitigation:** Before entering the translation loop, build a `dict[str, str]` mapping unique `source_text` values to their translations. Translate only unique texts, then fan results back to all rows sharing that source. This is a pure win with zero behavioral change.

---

### Issue 1.2: Re-parsing the same file on job submission after prior `/v1/parse` call

**Location:** `medtranslate-backend/app/main.py:176-205` (`/v1/parse`), `medtranslate-backend/app/main.py:213-248` (`/v1/jobs`)

**Why it increases cost:** The frontend calls `/v1/parse` to preview the CSV, then on "Run Translations" submits the same file to `/v1/jobs`, which re-reads and re-parses it from scratch. For XLSX files this involves loading `openpyxl`, iterating all rows, and building dicts a second time. While not an LLM cost, it doubles CPU and memory usage for file processing on every job submission.

**Scaling behavior:** O(n) per submission where n = row count. Constant 2x multiplier on parse work.

**Mitigation:** Return a parse token or cached row reference from `/v1/parse` that `/v1/jobs` can accept instead of a raw file, skipping re-parse. Alternatively, accept pre-parsed JSON rows directly in the job submission endpoint.

---

### Issue 1.3: `metrics_only` mode still recomputes METEOR and BLEU

**Location:** `medtranslate-backend/app/jobs.py:443-578` (phases 2-3 always execute)

**Why it increases cost:** When the user clicks "Run BERTScore Only" (frontend: `handleRunBertscoreOnly`), the backend receives `metrics_only=True`, which correctly skips translation (phase 1). However, phases 2 (METEOR) and 3 (corpus BLEU) still run unconditionally, recomputing scores that were already computed in the original job. METEOR is O(n) with NLTK tokenization per row; corpus BLEU is lighter but still redundant.

**Scaling behavior:** O(n) where n = scored rows. Wasted CPU is linear in dataset size.

**Mitigation:** When `metrics_only=True` and `compute_bertscore=True`, skip METEOR/BLEU phases if translations haven't changed. Alternatively, accept a flag like `bertscore_only` that jumps directly to phase 4.

---

## 2. TOKEN & PAYLOAD SIZE

### Issue 2.1: Full job state serialized to SQLite on every chunk boundary

**Location:** `medtranslate-backend/app/jobs.py:123-148` (`_job_to_dict`), `jobs.py:182-195` (`_db_save`), `jobs.py:482` (persist after each chunk)

**Why it increases cost:** `_persist(job)` is called after every 200-row chunk completes (line 482). The serializer `_job_to_dict` dumps the **entire** job state: all `rows[]` (with full clinical text) **and** all `sentence_metrics[]` (which duplicates most fields from rows). For a 5,000-row dataset with average 200-char clinical texts, each persist creates a ~15-40 MB JSON string. With `CHUNK_SIZE=200`, that's 25 serialization cycles, each creating and discarding a multi-MB temporary string.

**Scaling behavior:** O(n * n/chunk_size) = O(n²/200) total serialization work where n = row count. Each persist serializes all n rows, and there are n/200 persists. **This is quadratic.**

**Mitigation:**
- **Incremental persistence:** Only persist the delta (newly translated rows) per chunk, not the entire job.
- **Separate tables:** Store rows and sentence_metrics in normalized tables instead of a single JSON blob. Append new results rather than overwriting the full blob.
- **Deferred full persist:** Only serialize the complete job at terminal states (complete/failed/cancelled), not at every chunk boundary. Use a lightweight status update for progress tracking.

---

### Issue 2.2: `sentence_metrics` duplicates all fields from `rows[]` in the SQLite blob

**Location:** `medtranslate-backend/app/jobs.py:123-148` (`_job_to_dict`), `medtranslate-backend/app/schemas.py:54-64` (`SentenceMetrics`)

**Why it increases cost:** Each `SentenceMetrics` object contains `pair_id`, `source`, `content_type`, `source_text`, `spanish_source`, `english_reference`, and `llm_english_translation` — all of which are already present in the corresponding `InputRow`. The serialized JSON blob contains every text field twice: once in `rows[]` and once in `sentence_metrics[]`. This roughly doubles the SQLite storage, JSON serialization time, and network payload size.

**Scaling behavior:** O(n) storage overhead where n = row count. Constant 2x multiplier on blob size.

**Mitigation:** Store `sentence_metrics` with only `pair_id`, `meteor`, `bertscore_f1`, and `error`. Reconstruct full objects by joining with `rows[]` at response time. This halves the blob size and serialization cost.

---

## 3. PAGINATION & STREAMING

### Issue 3.1: Partial result fetches re-download all rows from offset 0

**Location:** `app/translate/page.tsx:92-96` (inside `makeStatusCallback`)

**Why it increases cost:** During job execution, the frontend fetches partial results every 6 seconds via `fetchJobResults(jobId, 0, 500)` — always starting from offset 0. This re-transfers all previously-fetched rows on every poll cycle. For a 5,000-row job, once 500 rows are done, every subsequent partial fetch re-downloads the same 500 completed rows plus any new ones.

**Scaling behavior:** O(min(translated, 500) * job_duration / 6s) total bytes transferred. For a long-running job, this is O(n * t) where t = job duration.

**Mitigation:** Track the last-fetched offset on the client. On subsequent fetches, request only `fetchJobResults(jobId, lastOffset, 500)` to get only new results. This reduces transferred data from O(n * t) to O(n) total.

---

## 4. MEMORY & RAM

### Issue 4.1: In-memory job cache grows without bound

**Location:** `medtranslate-backend/app/jobs.py:78` (`_jobs: dict[str, Job] = {}`)

**Why it increases cost:** Every job ever created is cached in `_jobs` and never evicted. Each `Job` holds the full `rows[]` list (all input text) and `sentence_metrics[]` list (all output text + metrics). A single 5,000-row job can consume 10-40 MB of RAM. After 100 jobs, this is 1-4 GB of process memory. Render's cheapest instance has 512 MB RAM; even the standard tier has 2 GB.

**Scaling behavior:** O(j * n) where j = total jobs created and n = average rows per job. **Monotonically increasing — never freed.**

**Mitigation:** Implement an LRU eviction policy on `_jobs`. Keep only the last K jobs or jobs accessed within the last T minutes in memory. Terminal-state jobs (complete/failed/cancelled) can be evicted first since they can be reloaded from SQLite on demand.

---

### Issue 4.2: BERTScore model (~400 MB) loaded once and never unloaded

**Location:** `medtranslate-backend/app/metrics.py:79` (`from bert_score import score as bert_score_fn`)

**Why it increases cost:** The `bert_score` library lazy-loads a RoBERTa model (~400 MB) on first use. Due to Python's module caching, this stays in memory for the lifetime of the process. On a 512 MB Render instance, this alone consumes 78% of available RAM, leaving little room for job data. If BERTScore is requested infrequently (opt-in feature), those 400 MB sit idle most of the time.

**Scaling behavior:** O(1) — fixed 400 MB overhead after first BERTScore job, regardless of usage frequency.

**Mitigation:**
- Run BERTScore computation in a separate subprocess that exits after completion, freeing the model memory.
- Alternatively, use `gc.collect()` and `torch.cuda.empty_cache()` after BERTScore computation, and clear the model reference.
- For production, consider offloading BERTScore to a dedicated worker or serverless function.

---

## 5. CONCURRENCY & BACKGROUND JOBS

### Issue 5.1: No global concurrency limit on jobs — unbounded API spend

**Location:** `medtranslate-backend/app/main.py:246` (`asyncio.create_task(execute_job(job_id))`)

**Why it increases cost:** Every `POST /v1/jobs` call spawns an async task with no queue, no backpressure, and no per-user or global limit. `MAX_CONCURRENT_TRANSLATIONS=4` limits parallelism **within** a single job, but 10 simultaneous job submissions = 40 concurrent LLM API calls. A single malicious or buggy client can trigger unlimited API spend.

**Scaling behavior:** O(j * c) where j = concurrent jobs and c = concurrent translations per job. Unbounded in j.

**Mitigation:**
- Add a global semaphore limiting total concurrent jobs (e.g., `MAX_CONCURRENT_JOBS=3`).
- Add per-user rate limiting (requires auth or IP-based throttling).
- Implement a job queue with bounded concurrency instead of fire-and-forget `create_task`.

---

### Issue 5.2: Jobs continue burning API credits after user disconnects

**Location:** `medtranslate-backend/app/main.py:246`, `medtranslate-backend/app/jobs.py:388-645`

**Why it increases cost:** `asyncio.create_task(execute_job(job_id))` fires and forgets. If a user submits a 10,000-row job, closes their browser, and never returns, the backend continues translating all 10,000 rows at full speed. There is no idle timeout, no heartbeat check, and cancellation is client-initiated only.

**Scaling behavior:** O(n) wasted API calls per abandoned job, where n = remaining untranslated rows.

**Mitigation:**
- Implement a server-side inactivity timeout: if no poll request arrives for a job within T minutes (e.g., 5 min), auto-cancel.
- Track the last poll timestamp per job and check it at chunk boundaries.

---

## 6. RETRY LOGIC

### Issue 6.1: No jitter on exponential backoff — thundering herd on rate limits

**Location:** `medtranslate-backend/app/translate.py:152,165,180,235,248,262`

**Why it increases cost:** The retry delay formula is `TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))` — deterministic, no jitter. When multiple concurrent translations hit a rate limit simultaneously (common with `MAX_CONCURRENT_TRANSLATIONS=4`), they all retry at exactly the same time, re-triggering the rate limit. This wastes retry attempts and extends the total backoff duration.

**Scaling behavior:** O(c) wasted retries per rate-limit event where c = concurrent translations hitting the limit together. With 4 concurrent tasks, each retry cycle wastes 3 of 4 attempts.

**Mitigation:** Add random jitter: `wait = base_delay * (2 ** attempt) * (0.5 + random.random())`. This is a one-line change per retry site. Also applies to the frontend retry logic in `api.ts:74`.

---

## 7. CACHING & REUSE

### Issue 7.1: No translation cache — identical texts retranslated across jobs

**Location:** `medtranslate-backend/app/translate.py:75-102`, `medtranslate-backend/app/jobs.py:417-431`

**Why it increases cost:** There is no caching layer for LLM translations. If a user re-runs the same dataset (e.g., after reviewing partial results), every row is re-translated. With `temperature=0.0` (the default), translations are deterministic — the same input always produces the same output. This is pure waste.

**Scaling behavior:** O(n * r) total API calls where n = rows and r = number of re-runs on the same data. In practice, users commonly re-run 2-3 times during evaluation.

**Mitigation:** Implement a translation cache keyed on `(model, system_prompt, temperature, source_text)`. For `temperature=0.0`, the output is deterministic and safe to cache. Use SQLite or Redis. Even a bounded in-memory LRU cache with 10,000 entries would eliminate most redundant calls.

---

## 8. DATABASE EFFICIENCY

### Issue 8.1: Cancellation check deserializes entire multi-MB JSON blob for one boolean

**Location:** `medtranslate-backend/app/jobs.py:213-229` (`_db_load_cancelled`)

**Why it increases cost:** To check if a job is cancelled (called at every chunk boundary during translation), the system reads the full `data` TEXT column from SQLite, parses the entire JSON blob (potentially 10-40 MB for large jobs), and extracts a single boolean field. This is called every 200 rows, so a 5,000-row job triggers 25 full JSON parses purely for a boolean check.

**Scaling behavior:** O(n * n/chunk_size) = O(n²/200) total JSON parse work for cancellation checks alone, where n = row count. Same quadratic pattern as Issue 2.1.

**Mitigation:** Add a `cancelled INTEGER DEFAULT 0` column to the `jobs` table. Update only that column on cancel requests. Read only that column for cancellation checks: `SELECT cancelled FROM jobs WHERE job_id = ?`. This reduces the cancellation check from multi-MB parse to a single integer read.

---

## 9. STORAGE & RETENTION

### Issue 9.1: No TTL or cleanup — SQLite and in-memory cache grow indefinitely

**Location:** `medtranslate-backend/app/jobs.py:78` (`_jobs`), `medtranslate-backend/app/jobs.py:182-195` (`_db_save`)

**Why it increases cost:** Neither the in-memory `_jobs` dict nor the SQLite `jobs` table has any eviction or TTL policy. Every job ever created is retained forever. On Render with a persistent disk, the SQLite database will grow without bound. A busy deployment with 100 jobs/day, 5,000 rows each, accumulates ~2-8 GB of database storage per month.

**Scaling behavior:** O(j * n) cumulative storage where j = total jobs over system lifetime and n = average rows per job. Monotonically increasing.

**Mitigation:**
- Add a `created_at` timestamp column and a periodic cleanup task that deletes jobs older than T days (e.g., 7 days).
- Implement in-memory eviction as described in Issue 4.1.
- At minimum, drop the `rows[]` field from persisted data after the job completes — only `sentence_metrics` are needed for result retrieval.

---

## SUMMARY

### Top 5 Highest Financial Risk Areas

| Rank | Issue | Risk Driver | Severity |
|------|-------|-------------|----------|
| 1 | **5.1: No global job concurrency limit** | Unbounded concurrent API spend; single client can trigger unlimited LLM costs | Critical |
| 2 | **7.1: No translation cache** | Every re-run re-translates all rows at temperature=0 (deterministic); 2-3x wasted API spend is typical | High |
| 3 | **1.1: No source text deduplication** | Duplicate clinical phrases each trigger separate API calls; 10-20% waste on typical clinical datasets | High |
| 4 | **4.1: Unbounded in-memory job cache** | OOM crash → downtime → data loss; 100 jobs ≈ 1-4 GB RAM on 512 MB instance | High |
| 5 | **2.1: Quadratic serialization on chunk persist** | O(n²) CPU and memory for large jobs; 5,000 rows = 25 full serializations of 15-40 MB each | Medium-High |

### Quick Wins (under 1 hour each)

1. **Add jitter to retry backoff** (Issue 6.1) — One-line change per retry site in `translate.py`. Prevents thundering herd on rate limits.

2. **Deduplicate source texts before translation** (Issue 1.1) — ~20 lines in `jobs.py`. Build a unique-text dict before the translation loop; fan results back after.

3. **Add `cancelled` column to SQLite** (Issue 8.1) — Small schema migration + query change. Eliminates multi-MB JSON parses for boolean checks.

4. **Track partial-fetch offset on client** (Issue 3.1) — ~5 lines in `translate/page.tsx`. Change `fetchJobResults(jobId, 0, 500)` to `fetchJobResults(jobId, lastOffset, 500)`.

5. **Add global job concurrency semaphore** (Issue 5.1) — ~10 lines in `main.py`. `asyncio.Semaphore(MAX_CONCURRENT_JOBS)` around `execute_job`.

### Structural Changes (architecture-level refactors)

1. **Normalized database schema** (addresses Issues 2.1, 2.2, 8.1, 9.1) — Replace the single JSON blob with proper tables: `jobs` (metadata), `rows` (input), `metrics` (output). Enables incremental writes, efficient queries, and partial eviction. This is the highest-leverage change for production readiness.

2. **Translation result cache** (addresses Issues 7.1, 1.1) — Add a persistent cache layer (SQLite table or Redis) keyed on `(model, prompt_hash, temperature, source_text_hash)`. Eliminates redundant LLM calls across jobs and re-runs. Pays for itself after the first re-run.

3. **Job queue with backpressure** (addresses Issues 5.1, 5.2) — Replace `asyncio.create_task` with a bounded job queue (e.g., `asyncio.Queue` with worker pool, or Celery/ARQ for multi-instance). Enables global concurrency limits, per-user quotas, priority scheduling, and server-side idle timeout for abandoned jobs.

4. **BERTScore isolation** (addresses Issue 4.2) — Run BERTScore in a subprocess or separate service to prevent the 400 MB model from consuming the main process's memory permanently. This is especially important on memory-constrained Render instances.
