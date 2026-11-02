# Performance, Cost, and Reliability Notes

This document records the changes made in release 1.6.0 to make large runs
(the full 3,934-row ClinSpEn corpus and beyond) faster and cheaper, to remove
points of failure, and to make every page usable on a phone. Each entry says
what was wrong, what changed, why, and what to expect. The last section lists
things that were deliberately left alone.

---

## 1. Where the time actually goes

Measured on this development machine with 3,000 synthetic clinical-length
sentence pairs (Render's shared CPUs are roughly 2 to 4 times slower):

| Step | Time for 3,000 rows | Notes |
|---|---|---|
| Translation (API calls) | minutes | Bound by the provider; 4 concurrent calls by default, 2 to 5 s each at `medium` effort |
| METEOR (NLTK, WordNet) | 4.3 s cold, 1.5 s warm | 1.4 ms per row |
| Corpus BLEU (sacrebleu) | 0.3 s | Negligible |
| BERTScore (roberta-base, CPU) | several minutes | Plus 10 to 60 s to start a subprocess, import torch, and load the model, and a one-time model download if the cache is cold |
| Job bookkeeping before this release | 4.8 s | An O(n²) loop and one SQLite connection per sentence; see below |
| Job bookkeeping after this release | 0.7 s | |

So "the computations take longer than the translations" means BERTScore. METEOR
and BLEU are cheap. BERTScore is inherently expensive on a CPU, so the work
below focuses on never computing it twice and on keeping its model cached.

## 2. Backend changes

### 2.1 Translation cache reads and writes are batched

**Problem.** The translation cache opened a fresh SQLite connection for every
unique sentence, once to read and once to write. On the full corpus that is
about 8,000 connections per run, serialized through a lock.

**Change.** `jobs._cache_get_many()` fetches all keys in chunked `IN (...)`
queries on one connection before translation starts; `jobs._cache_set_many()`
writes each chunk of 200 translations in one transaction.

**Effect.** Cache lookup for 3,000 rows is one round-trip instead of 3,000.
Removes the lock contention that could stall translation chunks.

### 2.2 Quadratic progress counting removed

**Problem.** Inside the fan-out loop that copies each unique translation to
its rows, `job.translated` was recomputed by scanning all rows for every row.
On 3,000 rows that is about nine million iterations per chunk, fifteen times
per run.

**Change.** Counts are recomputed once after the loop (`_update_failure_counts()`
and a single `sum`).

**Effect.** Measured bookkeeping overhead for a 3,000-row run fell from 4.8 s
to 0.7 s in the stubbed test.

### 2.3 Per-sentence metric cache (METEOR and BERTScore)

**Problem.** Every re-score ("Run BERTScore Only", "Retry incomplete rows",
and now "Apply reviewer overrides") recomputed METEOR and BERTScore for every
row, even though nothing about those rows had changed. For BERTScore this is
the single largest cost in the system.

**Change.** A `metric_cache` table in the same SQLite file stores one value per
`(metric, config, candidate, reference)`. The METEOR key includes the NLTK
version; the BERTScore key includes the model and rescaling configuration.
Rows found in the cache skip computation; only the missing rows go to NLTK or
to the BERTScore subprocess, and their results are written back in one
transaction.

**Effect.** A repeat run of an unchanged file makes zero metric calls (verified
in the stubbed test). After retrying 20 incomplete rows out of 3,000, the
re-score sends 20 rows to BERTScore instead of 3,000. Reviewer overrides re-score
nothing but corpus BLEU.

**Caveat.** The cache does not expire. If you upgrade NLTK, METEOR keys change
automatically; if you change the BERTScore model, update `_BERTSCORE_CONFIG`
in `jobs.py` or delete the table.

### 2.4 BERTScore model cache kept on the persistent disk

**Problem.** The BERTScore subprocess downloads roberta-base (about 500 MB)
into the container's home directory on first use. On Render, that directory
is ephemeral: every deploy or restart downloaded the model again, which is
slow and uses bandwidth you pay for.

**Change.** `metrics._bertscore_subprocess()` sets `HF_HOME` to an `hf-cache`
folder next to the SQLite database (the mounted Render Disk) unless `HF_HOME`
is already set.

**Effect.** One download per deployment instead of one per restart. Set
`HF_HOME` explicitly if you prefer another location.

### 2.5 Checked-in virtualenv and placeholder files removed

**Problem.** `medtranslate-backend/source/` was a Python virtualenv committed
to git (749 files, 13 MB of site-packages). It was never used by the
Dockerfile, bloated every clone and every Render build upload, and would
have shadowed real dependencies if anyone activated it. `worker.py` was a
placeholder that only ran uvicorn.

**Change.** Both removed; `source/` is now in `.gitignore`.

### 2.6 Upload size halved

**Problem.** The CSV the frontend sends to `POST /v1/jobs` carried every
source sentence twice (`source_text` and the legacy `spanish_source` column).

**Change.** Only `source_text` is sent. The backend already read it first.

### 2.7 Reviewer override is honoured by the scorer

**Problem.** Once refusals were scored as zero (1.5.0) there was no way to
remove a refusal that a physician judged legitimate, so a model could be
penalised for correctly declining a non-clinical line.

**Change.** A new `error_kind` value, `excluded`, is accepted on metrics-only
submissions. Excluded rows are kept out of METEOR, BERTScore, and corpus BLEU
and counted in `excluded_rows`. The frontend stores the reviewer's decision per
`pair_id`, applies it immediately to all sentence-level numbers on every page,
and offers a one-click re-score on the Translate page so corpus BLEU drops the
row too. The decision is a property of the source sentence, so it applies to
every model's run of that pair, which keeps comparisons fair.

## 3. Frontend changes

### 3.1 One re-score path instead of three

**Problem.** "Run BERTScore Only", the retry flow's final step, and the new
override re-score each had their own copy of the submit, poll, merge, and
persist logic. Three copies meant three places to get the abort handling,
error recovery, or comparison-store update wrong.

**Change.** `app/translate/page.tsx` now has `beginRun()`, `runMetricsOnly()`,
`commitResults()`, and `rescore()`; the three user actions are thin wrappers.
Error handling restores the previous results in one `finally` block.

### 3.2 Row classification in one place

`lib/metrics.ts: rowStatus()` is the single source for how a row's state is
named and coloured (Complete, Refused, Excluded, Incomplete, Pending). The
Translate table, the CSV exports, and the status pills all use it, so a new
state cannot be shown inconsistently.

### 3.3 Responsive layout

**Problem.** On an iPhone, tables inside cards were clipped by the card's
`overflow: hidden` (the Winner column on Compare, the Notes column on About,
the dataset breakdown on Metrics, the grading-scale modal), and the
three-column pair detail forced the browser to zoom out to a 648 px layout
viewport, pushing the grade buttons off the card. The Translate action
buttons sat in a non-wrapping row.

**Change.**
- `.table-scroll`: every data table inside a card scrolls sideways; text
  columns opt into wrapping with `.wrap`.
- `.pair-grid`: the source / reference / translation panels use
  `repeat(auto-fit, minmax(200px, 1fr))`, so they stack on phones.
- `.pair-footer` and `.grade-selector`: the metrics and grade buttons wrap.
- `.compare-selectors`: Model A / vs / Model B stack under 640 px.
- `.button-row`: action buttons wrap and shrink instead of overflowing.

**Verification.** A Playwright pass at 390×844 (iPhone 12/13/14 width) over
every page and both modals reports no element extending past the viewport and
a layout viewport equal to the device width on every page.

## 4. Cost on Render

Render bills by instance size and running hours, not per job. What drives the
bill is the instance you need to keep torch resident:

| Need | Instance | Why |
|---|---|---|
| Translation, METEOR, BLEU only | Starter (512 MB) | No torch in the API process |
| BERTScore as well | Standard (2 GB) or larger | roberta-base needs about 1.5 GB during inference |

Ways to keep the bill down that are now supported by the code:

1. Leave "Include BERTScore" off for exploratory runs; add it once per dataset
   with "Run BERTScore Only". The metric cache means you never pay for the same
   row twice.
2. Use the mounted Disk (`DATABASE_PATH` and the `hf-cache` beside it) so the
   model is downloaded once.
3. Scale the instance down between study phases; the SQLite file and caches
   survive on the Disk.
4. API spend is separate and is dominated by translation calls. The
   translation cache means a re-run with unchanged settings costs nothing; a
   prompt or effort change costs one call per unique sentence.

## 4b. The frozen progress bar (1.7.0)

**Problem.** Progress appeared to jump from 0 % to 100 %. Two causes:

1. A race in the backend's job reader. A status poll that arrived while the worker was picking the job up read the job from SQLite and then overwrote the live in-memory object with that stale copy. Every later poll on the executing instance returned the frozen copy until the job finished and the reader fell back to the database. With the frontend polling immediately after submit, this happened on most runs.
2. Progress was only written per 200-row chunk and METEOR/BERTScore only at the end of their phase, so even without the race a small job moved in one step.

**Change.** The reader never replaces a job that is executing on this instance. Translations and failures are written to their rows the moment each sentence finishes; METEOR updates every 25 rows; the BERTScore subprocess streams each chunk's scores; the job reports a `phase`; SQLite progress writes are throttled to one every 2 s. The Translate page shows a phase-aware bar and re-fetches the table every few seconds so rows fill in.

**Effect.** In the stubbed test a 16-row job produced 17 distinct progress states across all four phases instead of one.

## 5. Points of failure removed or reduced

| Risk | Before | After |
|---|---|---|
| Rows silently vanish from scores | Failed rows carried a generic error and were dropped | Classified, kept, counted, retryable or scored (1.5.0) |
| Lost reviewer judgment on refusals | None possible | Override stored per pair, applied everywhere, exported |
| Re-score paths drift | Three hand-written copies | One helper with one error path |
| Cache lock contention | One connection per sentence | One batch per chunk |
| Model re-download on restart | Ephemeral HF cache | Cache on the persistent Disk |
| Quadratic slowdown on big files | Present | Removed |
| Committed virtualenv shadows deps | Present | Removed and ignored |
| Clipped controls on phones | Present | Verified fixed at 390 px |

## 6. Deliberately left alone, and why

- **BERTScore toggle default.** Left off, as requested. It remains the most
  expensive step.
- **Idle auto-cancel (5 minutes without a poll).** This protects you from a
  closed tab running up API spend on a 3,000-row job. The Translate page
  resumes polling when reopened, but a job cancelled by the timeout must be
  re-run; the translation cache makes that re-run cheap. Raise
  `JOB_IDLE_TIMEOUT` (seconds) if you often switch away during long runs.
- **Translation concurrency (4).** Raising `MAX_CONCURRENT_TRANSLATIONS`
  shortens wall time roughly proportionally until the provider rate-limits;
  retries handle that, but each retry is a wasted call. Try 6 to 8 on a paid
  tier.
- **Full-blob status writes.** The job's full state is written to SQLite at
  each chunk boundary. Measured at about 50 ms per write for 3,000 rows, it is
  not a bottleneck, and it is what lets a second Render instance answer polls.
- **`scripts/translate_batch.py` and `scripts/metrics/compute_all.py`.** The
  offline pipeline duplicates the backend's translator and uses sentence-level
  BLEU rather than corpus BLEU. It is documented as a separate path for
  controlled environments and was not changed.
- **Duplicate source sentences.** Identical sentences share one translation
  and one score. Good for cost; note in the methods section that they are not
  independent samples.
