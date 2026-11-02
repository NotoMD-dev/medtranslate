# Changelog

All notable changes to the MedTranslate project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
