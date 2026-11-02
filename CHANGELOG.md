# Changelog

All notable changes to the MedTranslate project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.7.0] - 2026-11-02

### Fixed — Progress that actually moves

- **Stale-job race** in `jobs._get_job()`: a status poll arriving while the worker picked up the job replaced the live in-memory job with its SQLite copy, freezing every later poll at 0 until completion (the "0 % then 100 %" symptom). The reader now never overwrites a job that is executing on this instance
- Translations and failures are written to their rows as each sentence finishes (not per 200-row chunk); `translated`, `refused_rows`, `incomplete_rows` update per sentence; chunk size default lowered to 50 so Stop responds faster
- METEOR fills rows and `scored` every 25 rows; the BERTScore subprocess streams each chunk's F1 values so rows fill during BERTScore; cached BERTScore values appear immediately
- `JobStatusResponse.phase` (`queued`, `translating`, `meteor`, `bleu`, `bertscore`, `complete`, `failed`, `cancelled`); SQLite progress writes throttled to every 2 s (`STATUS_PERSIST_INTERVAL`)
- Translate page: one phase-aware progress bar with per-phase labels and an indeterminate state for BLEU and model loading; the table is re-fetched every 3 s (8 s above 1,500 rows) so translations and scores appear per row; same during BERTScore-only, retry and override re-scores

### Changed — Models

- **Claude Opus 5.5 replaces Claude Sonnet 5.5** as the comparison model: both offered models are now their provider's flagship, at medium effort. Saved runs keyed `claude-sonnet-5-5` still display with a "(retired)" label
- Compare page: with one run saved, a "Compare against" block greys out the model already run and offers "Translate the same dataset with <other model>", which opens the Translate page with that model selected and starts the run (`/translate?model=<id>&autorun=1`); with two runs, any model not yet run is offered above the table
- About page explains the flagship-versus-flagship choice and the one-click comparison

### Changed — Exports

- Results and review CSVs gain a `reviewer_override_note` column; the Translate export applies reviewer overrides (status `excluded`) before writing. Both exports verified by a browser download test

---

## [1.6.0] - 2026-11-02

See [PERFORMANCE_AND_RELIABILITY.md](PERFORMANCE_AND_RELIABILITY.md) for the reasoning behind each change and measured effects.

### Changed — Backend performance and cost

- **Batched translation cache I/O**: one chunked `IN (...)` read before translation and one `executemany` write per chunk, replacing one SQLite connection per sentence
- **Quadratic progress counting removed** from the translation fan-out loop; a 3,000-row run's bookkeeping dropped from 4.8 s to 0.7 s in the stubbed test
- **Per-sentence metric cache** (`metric_cache` table): METEOR and BERTScore values are stored per candidate/reference pair and reused on every re-score, so BERTScore-only runs, retries, and override re-scores only compute rows that are new
- **BERTScore model cache on the persistent disk**: the subprocess sets `HF_HOME` to `<db dir>/hf-cache` unless already set, so roberta-base is downloaded once per deployment, not once per container start
- **Upload halved**: the submission CSV no longer repeats the source text in a legacy `spanish_source` column

### Added — Reviewer refusal override

- A physician can mark a refusal as legitimate on the Review page (with an optional note). The pair becomes `error_kind: "excluded"`: left out of METEOR, BERTScore, counts, and, after "Apply reviewer overrides & re-score" on the Translate page, corpus BLEU. The decision is stored per `pair_id`, applies to every model's run of that pair, can be undone, and is exported as status `excluded`
- `JobStatusResponse.excluded_rows`; Metrics shows excluded counts and warns when overrides are not yet reflected in corpus BLEU; Compare shows an "Excluded by reviewer" row

### Changed — Frontend structure

- Translate page re-score flows (BERTScore-only, retry, override) share `beginRun` / `runMetricsOnly` / `commitResults` / `rescore` helpers with one error path
- `lib/metrics.ts: rowStatus()` is the single source for row state names and colours; CSV exports use it

### Changed — Responsive layout

- `.table-scroll` wrappers on every card table (Compare, About, Metrics, grading-scale modal); `.pair-grid` stacks the three text panels on phones; `.pair-footer`, `.grade-selector`, `.button-row` wrap; `.compare-selectors` stack under 640 px; the BLEU signature wraps. Verified with a 390 px Playwright pass over every page and modal: no clipped controls and the layout viewport equals the device width

### Removed

- `medtranslate-backend/source/` (a committed virtualenv, 749 files) and `medtranslate-backend/worker.py` (placeholder)

### Fixed (post-merge, mobile)

- Upload page: a long file name (e.g. the demo CSV) could not shrink, pushing "Remove file" off the card on phones. The card now wraps, the name breaks anywhere, and the button never leaves the card
- Navigation: six tabs wrapped onto two lines on phones; the nav is now one horizontally scrollable row under 480 px
- Upload page: "Rows to analyze" and other choice buttons stack vertically under 480 px instead of squeezing labels into three lines

---

## [1.5.0] - 2026-11-02

### Changed — Prompt

- The default system prompt (frontend `buildSystemPrompt()` and backend `DEFAULT_SYSTEM_PROMPT`) now ends with: *"Output only the English translation, with no preamble, notes, quotation marks, or explanations."* Metrics score the whole reply, so wrapper text was lowering BLEU sharply (precision-based) while barely moving METEOR (recall-weighted). **Runs made with the old prompt are not comparable with new runs**; the Compare page now warns when two runs used different prompts.

### Added — Failure accounting

- **Error classes.** `translate.TranslationRefused` is raised for content filters, explicit declines, and empty replies; `classify_error()` maps every failure to `"refusal"` or `"infrastructure"`. Each failed row keeps its exact provider message in `error` and its class in `error_kind` (previously collapsed to the string "Translation failed").
- **Refusals are scored.** A refused row gets METEOR 0, BERTScore 0 (when BERTScore is on), and an empty hypothesis in corpus BLEU, so a model that declines is penalised instead of silently dropped. Infrastructure failures stay unscored.
- **Counts.** `JobStatusResponse` and the persisted job carry `refused_rows` and `incomplete_rows` (`failed_rows` is their sum). Metrics page shows a Translation Failures section with a reason breakdown; Compare shows Refused and Incomplete rows per model; Translate shows the counts in the header and the real error per row.
- **Retry incomplete rows.** The Translate page re-translates only infrastructure failures as a fresh job, merges the results, and re-scores the whole set in metrics-only mode so corpus BLEU covers every row. The submission CSV gained optional `error` and `error_kind` columns so a metrics-only re-score keeps failed rows' status.
- **Format warnings.** `app/output_checks.py: detect_format_warning()` flags replies that start with a preamble, contain a translator's note, are wrapped in quotation marks, use markdown, or add paragraphs the source did not have. Stored as `SentenceMetrics.format_warning`, shown in the Translate table, PairDetail, and the Review queue, and exported. The text itself is never modified.
- **Review queue.** Refused rows enter the queue first with a "Refused" badge and the error reason; completed rows below the threshold follow in dataset order.
- **Shared review threshold.** The Review page threshold is saved to the session and the Metrics page "Flagged for Review" count uses it instead of a hard-coded 0.4.
- **Small-sample caution** on Translate, Metrics, and Compare when fewer than 50 scored rows are present.
- **Exports** (`medtranslate_results.csv`, `medtranslate_review.csv`) gained `status`, `error`, and `format_warning` columns.

### Fixed

- Rows never attempted because a job was stopped are left pending instead of being marked failed.
- The Review page labelled every non-ClinSpEn source as "UMass"; it now shows the actual source name.

---

## [1.4.0] - 2026-11-02

### Added — Onboarding and Explanations

- **Plain-language metric guide** (`components/MetricGuide.tsx`): a "What do these scores mean?" link on the Metrics and Compare pages opens a modal explaining SacreBLEU, METEOR, and BERTScore in everyday language, with score bands, why the metrics disagree, and what they cannot detect
- **About page** (`/about`): purpose of the study, the five-step run pipeline, the models in use with their reasoning effort settings, the system prompt, the physician grading scale, data sources, and a "not a clinical tool" caveat
- **Demo datasets** (`public/demo/`): synthetic Spanish and French CSVs (15 rows each) with one-click "Try a demo" buttons on the Upload page and a download link to show the expected format
- **Reasoning effort recorded per job**: the backend now stores the effort applied to a run in `ModelConfig.reasoning_effort` (returned as `translation_config.reasoning_effort`), and the Compare page shows it under each model name

### Fixed

- **Compare tally**: a metric that was not computed for either run (typically BERTScore) was counted as a "tie"; it is now shown as "Not computed" and left out of the win/tie counts, with a hint on how to enable it
- **Translation cache ignored reasoning effort**: the SQLite cache key was `(model, system_prompt, temperature, source_text)`, so changing `OPENAI_REASONING_EFFORT` or `ANTHROPIC_EFFORT` and re-running the same file silently reused translations produced at the old effort. The effort is now part of the key, and the effort recorded on the job is taken from the same helper that the translator uses, so results and cache agree. Existing cache rows are orphaned (one extra provider call per unique text on the next run)

- **Temperature was reported as `0.0` for every job, including models that never received it**: `POST /v1/jobs` forced `temperature=0.0` into `translation_config` "for deterministic decoding", but GPT-5.x reasoning models and current Claude models reject the parameter and it was never sent. `translation_config.temperature` is now the value actually forwarded (`0.0` for older OpenAI chat models, `null` otherwise), computed by `translate.effective_temperature()` next to the branching that decides what each provider receives. The cache still stores `null`-temperature runs (the model takes no temperature, so there is nothing more deterministic to wait for); non-zero temperatures are still never cached. Frontend `ModelConfig.temperature` is now `number | null`

### Documentation

- **ARCHITECTURE.md**: directory structure (Compare/About pages, MetricGuide, `public/demo/`, `bertscore_worker.py`); pipeline diagram corrected to the real phase order (METEOR → BLEU → BERTScore) with dedupe and cache; new "What Triggers Clinician Review", "Job Store: Memory plus SQLite", "Translation Cache", and "Reasoning Effort Is Recorded" sections replacing the stale "In-Memory Job Store (MVP)"
- **SECURITY.md**: the "No Persistent PHI Storage" section was wrong; the backend persists jobs and a translation cache to SQLite. Rewritten to describe what is stored, retention, and how to run memory-only; added a note that `public/demo/` is public and must stay synthetic; LLM-provider section now covers Anthropic
- **METRICS_VALIDATION.md**: which rows are scored, how translations are produced (dedupe, cache, effort, temperature not sent, preamble caveat), and an explicit "What Triggers Clinician Review" table
- **DATA_SCHEMA.md**: `reasoning_effort` on `ModelConfig`; generalized source-language column; demo files
- **SYSTEMS_DESIGN.md**: information architecture now lists Compare and About; `MetricGuide` component spec (including the portal rationale); Upload page demo controls; Compare and About page specifications
- **medtranslate-backend/README.md**: project structure, source-column detection, recorded translation settings, translation cache, additional environment variables

---

## [1.3.0] - 2026-02-25

### Added — Systems Design Documentation

- **SYSTEMS_DESIGN.md**: Full UI/UX design specification covering design tokens, typography, color system, spacing, elevation, component library (primitives and app components), page specifications, interaction patterns, theming, animations, iconography, accessibility, and guidelines for adding or modifying elements

### Changed — Documentation Refresh

- **README.md**: Added Features section, Tech Stack table, Documentation index; updated directory structure to include design system and IndexedDB; added cancel endpoint to API table; added links to all documentation files
- **ARCHITECTURE.md**: Added design system section, IndexedDB storage documentation, XLSX backend parsing note, BERTScore model switch note; updated directory structure with `src/design-system/` and `lib/idb.ts`; added client-side storage table
- **API_SPEC.md**: Added `POST /v1/jobs/{job_id}/cancel` endpoint; added `compute_bertscore` form field; added XLSX file support; updated status enum to include `cancelled`; documented `roberta-base` model; updated `model_config` to `translation_config`
- **DATA_SCHEMA.md**: Added IndexedDB schema (database, object store, keys, functions); added theme storage; added `ModelConfig`, `JobStatus`, and `CLINICAL_GRADES` type definitions; added XLSX input section; updated localStorage schema
- **SECURITY.md**: Added File Upload Security section documenting XLSX vulnerability fix; added client-side storage security table; updated input validation for XLSX; added `xlsx` removal to deployment checklist
- **METRICS_VALIDATION.md**: Added BERTScore lazy loading documentation; added `roberta-base` model note; added Metrics Display section documenting dashboard and per-row display; added configurable METEOR threshold documentation
- **CHANGELOG.md**: This entry
- **medtranslate-backend/README.md**: Added cancel endpoint; added XLSX support note; added environment variable table; added project structure section

---

## [1.2.0] - 2026-02-24

### Changed — UI Redesign

- Redesigned the entire frontend with a calm academic theme
- Added token-based design system (`src/design-system/`) with CSS custom properties
- Added light/dark mode toggle via `ThemeProvider`
- Added UI primitives: Card, Button, Badge, MetricValue, ProgressBar, GradeRow, SectionLabel, PageHeader
- Replaced hard-coded styles with CSS variable references
- Added fadeUp entry animations with staggered delays
- Added custom scrollbar styling
- Updated navigation bar with theme toggle button

### Fixed

- Fixed XLSX upload handling
- Fixed CORS configuration for production deployment
- Fixed corpus BLEU crash on empty datasets

---

## [1.1.0] - 2026-02-23

### Fixed — Security & Stability

- **XLSX vulnerability**: Removed `xlsx` (SheetJS) npm package from frontend; moved Excel parsing to backend using `openpyxl`
- **IndexedDB storage**: Added `lib/idb.ts` for storing large job results that exceed localStorage's ~5MB quota
- **Translation abort**: Added job cancellation via `POST /v1/jobs/{id}/cancel`
- **Clinical grading queue**: Added queue-based review workflow with configurable METEOR threshold
- **Render OOM**: Switched BERTScore model to `roberta-base` for memory stability on Render
- **Render port binding**: Fixed dynamic port binding for Render deployment
- **Pydantic v2**: Fixed reserved field name conflict (renamed `model_config` to `translation_config` in schemas)
- **SacreBLEU display**: Fixed BLEU signature display formatting
- **BLEU signature error**: Fixed error when computing BLEU on datasets with missing references
- **METEOR scores**: Fixed missing METEOR scores for rows with empty reference translations

---

## [1.0.0] - 2026-02-21

### Changed — Backend-Driven Architecture Migration

Migrated from a demo (client-side metrics, direct OpenAI calls from Next.js API route) to a **publication-grade backend-validated architecture**. All translation and metric computation now occurs server-side in a dedicated FastAPI backend.

#### Backend Added (`medtranslate-backend/`)

- **FastAPI application** (`app/main.py`): Three endpoints — `POST /v1/jobs`, `GET /v1/jobs/{id}`, `GET /v1/jobs/{id}/results`
- **Translation module** (`app/translate.py`): OpenAI Python SDK with retry logic and rate-limit awareness
- **Metrics module** (`app/metrics.py`):
  - Corpus BLEU via `sacrebleu` with default 13a tokenization and signature reporting
  - Sentence-level METEOR via NLTK `single_meteor_score` with full WordNet + Porter stemming
  - BERTScore via `bert-score` with `rescale_with_baseline=True`
  - Library version reporting for reproducibility
- **Job system** (`app/jobs.py`): In-memory async job store with background execution
- **Pydantic schemas** (`app/schemas.py`): Typed request/response models
- **Configuration** (`app/config.py`): Environment-variable-based settings
- **Dockerfile**: Python 3.11 with NLTK data pre-downloaded
- **requirements.txt**: fastapi, uvicorn, openai, sacrebleu, nltk, bert-score, torch, numpy, pydantic, python-multipart, pandas

#### Frontend Changed

- **Removed**: `app/api/translate/route.ts` — no more direct OpenAI calls from the frontend
- **Removed**: All client-side metric computation functions from `lib/metrics.ts` (computeBLEU, computeMETEOR, computeBERTProxy, computeAllMetrics)
- **Removed**: `openai` and `@anthropic-ai/sdk` npm dependencies
- **Added**: `lib/api.ts` — backend API client with `submitJob()`, `pollJobStatus()`, `fetchJobResults()`, `pollUntilDone()`
- **Updated**: `lib/types.ts` — added backend types (`JobResults`, `SentenceMetrics`, `CorpusMetrics`, `LibraryVersions`, etc.); removed `TranslationResult` and `MetricsSummary`
- **Updated**: `lib/session.ts` — stores `jobId`, `jobResults`, and clinical `grades` instead of `TranslationResult[]`
- **Updated**: `lib/csv.ts` — added `pairsToCSVFile()` for backend upload; updated `exportResultsCSV()` for new data model
- **Updated**: `app/translate/page.tsx` — submits jobs to backend, polls progress, displays backend results
- **Updated**: `app/metrics/page.tsx` — displays corpus BLEU from sacrebleu, sentence METEOR/BERTScore, library versions
- **Updated**: `app/review/page.tsx` — uses backend sentence metrics for review flagging
- **Updated**: `components/PairDetail.tsx` — uses `SentenceMetrics` type with METEOR and BERTScore F1
- **Added**: `.env.example` with `NEXT_PUBLIC_BACKEND_URL`

#### Documentation Updated

- `ARCHITECTURE.md` — Added backend service diagram, removed client-side metrics description
- `API_SPEC.md` — Documented all job endpoints (`POST /v1/jobs`, `GET /v1/jobs/{id}`, `GET /v1/jobs/{id}/results`)
- `METRICS_VALIDATION.md` — Recorded library versions, documented reproducibility strategy
- `DATA_SCHEMA.md` — Added `JobResults`, `CorpusMetrics`, `SentenceMetrics` structures
- `SECURITY.md` — Documented: no API keys client-side, HTTPS required, no persistent PHI storage, log scrubbing
- `CHANGELOG.md` — This entry
- `README.md` — Added local run instructions for both services, Render deployment steps

---

## [0.1.0] - 2026-02-21

### Added

- **Initial platform release**: Full clinical translation research platform with client-side metrics (demo grade).

#### Web Application
- Upload page with CSV/XLSX support, drag-and-drop, system prompt configuration, row limits
- Translate page with batch translation, live progress, per-row status tracking
- Review page with BLEU-based flagging and clinical significance grading
- Metrics page with aggregate scores and source-level comparisons
- Translation API route supporting both OpenAI and Anthropic providers

#### Libraries
- `lib/metrics.ts`: Client-side BLEU, METEOR, BERTProxy (n-gram cosine similarity)
- `lib/csv.ts`: CSV/XLSX parsing and export
- `lib/session.ts`: localStorage persistence

#### Python Scripts
- `scripts/build_dataset.py`: Corpus unification
- `scripts/translate_batch.py`: Headless batch translation
- `scripts/metrics/compute_all.py`: Research-grade metrics pipeline

### Fixed
- BLEU smoothing alignment with Python backend
- State persistence across tabs and page reloads
