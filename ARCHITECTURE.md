# Architecture

This document describes the system architecture of MedTranslate, a clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.

## Overview

MedTranslate uses a **two-service architecture**: a Next.js frontend deployed to Vercel and a FastAPI backend deployed to Render. All translation and metric computation occurs server-side in the Python backend. The frontend handles file upload, job submission, progress polling, result visualization, and physician-adjudicated clinical grading.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MedTranslate                                     │
│                                                                          │
│  Frontend (Next.js — Vercel)              Backend (FastAPI — Render)     │
│  ┌─────────────┐                          ┌─────────────────────────┐   │
│  │   Upload     │── CSV/XLSX upload ─────>│ POST /v1/jobs           │   │
│  │  (page.tsx)  │                         │  ├── Parse CSV/XLSX     │   │
│  └──────┬──────┘                          │  ├── OpenAI translate   │   │
│         │                                  │  ├── SacreBLEU (corpus)│   │
│  ┌──────▼──────┐                          │  ├── NLTK METEOR       │   │
│  │  Translate   │── Poll status ────────> │  ├── BERTScore          │   │
│  │(translate/) │<── JSON results ────────│  └── Return results     │   │
│  └──────┬──────┘                          └─────────────────────────┘   │
│         │                                          │                     │
│  ┌──────▼──────┐                          ┌────────▼────────────────┐   │
│  │   Review     │                         │  OpenAI / Anthropic API │   │
│  │  (review/)  │                          │ (GPT-5.6 Sol / Opus 5.5)│   │
│  └──────┬──────┘                          └─────────────────────────┘   │
│         │                                                                │
│  ┌──────▼──────┐                                                        │
│  │   Metrics    │                                                        │
│  │  (metrics/) │                                                        │
│  └─────────────┘                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | Next.js 15 (App Router) | File-based routing, SSR, Vercel deployment |
| **Frontend Language** | TypeScript 5.9 | Type-safe frontend code |
| **UI** | React 19, Tailwind CSS 3.4 | Component-based UI with utility-first styling |
| **Design System** | CSS custom properties + primitives | Token-based theming with light/dark mode |
| **Icons** | Lucide React 0.468.0 | SVG icon library |
| **File Parsing** | PapaParse (CSV, frontend) | Client-side CSV parsing |
| **Storage** | localStorage + IndexedDB | Session persistence for small and large data |
| **Analytics** | Vercel Analytics 1.6.1 | Deployment analytics |
| **Backend Framework** | FastAPI | Async Python API with auto-generated OpenAPI docs |
| **LLM Provider** | OpenAI Python SDK | Server-side translation (API key never in frontend) |
| **XLSX Parsing** | openpyxl (backend) | Server-side Excel parsing (security fix) |
| **Corpus BLEU** | sacrebleu | Corpus-level BLEU with default 13a tokenization |
| **METEOR** | NLTK meteor_score | Full WordNet + Porter stemming + alignment penalty |
| **BERTScore** | bert-score (HuggingFace) | Contextual embeddings with rescale_with_baseline=True |
| **Deployment** | Vercel (frontend) + Render (backend) | Production hosting |

## Directory Structure

```
medtranslate/
├── app/                          # Next.js App Router (pages only — no API routes)
│   ├── layout.tsx                # Root HTML layout, metadata
│   ├── globals.css               # Global styles, CSS variables, animations
│   ├── page.tsx                  # "/" — Upload & configuration page
│   ├── translate/
│   │   └── page.tsx              # "/translate" — Job submission and result display
│   ├── review/
│   │   └── page.tsx              # "/review" — Clinical safety review
│   ├── metrics/
│   │   └── page.tsx              # "/metrics" — Aggregate metrics dashboard
│   ├── compare/
│   │   └── page.tsx              # "/compare" — Head-to-head comparison of two model runs
│   └── about/
│       └── page.tsx              # "/about" — Purpose, pipeline, models/effort, score guide
│
├── components/                   # Shared React components
│   ├── Header.tsx                # Top navigation bar with workflow tabs and theme toggle
│   ├── MetricGuide.tsx           # "What do these scores mean?" modal + explainer text
│   ├── PairDetail.tsx            # Three-column translation detail panel
│   └── GradeSelector.tsx         # Clinical significance grade buttons (0–3)
│
├── public/demo/                  # Static assets served by Next.js
│   ├── medtranslate_demo_spanish.csv   # Synthetic 15-row Spanish demo (no PHI)
│   ├── medtranslate_demo_french.csv    # Synthetic 15-row French demo (no PHI)
│   └── README.md
│
├── src/design-system/            # Design tokens and UI primitives
│   ├── tokens.css                # CSS custom properties (light mode defaults)
│   ├── theme.css                 # Dark mode overrides, transitions, animations
│   ├── index.ts                  # Barrel exports for all primitives
│   └── primitives/               # Base UI components
│       ├── ThemeProvider.tsx      # Theme context & toggle (light/dark)
│       ├── Card.tsx              # Surface container with shadow
│       ├── Button.tsx            # Action button (primary/secondary/ghost)
│       ├── Badge.tsx             # Status/dataset label
│       ├── MetricValue.tsx       # Large metric display with label
│       ├── ProgressBar.tsx       # Job progress indicator
│       ├── GradeRow.tsx          # Grade distribution bar
│       ├── SectionLabel.tsx      # Horizontal divider with label
│       └── PageHeader.tsx        # Page title and subtitle
│
├── lib/                          # Shared non-UI logic
│   ├── types.ts                  # TypeScript interfaces (frontend + backend types)
│   ├── api.ts                    # Backend API client (submitJob, pollStatus, fetchResults)
│   ├── metrics.ts                # Display helpers (summarizeMetric only — no computation)
│   ├── csv.ts                    # CSV parsing, CSV export, pairsToCSVFile
│   ├── session.ts                # localStorage-based session state persistence
│   └── idb.ts                    # IndexedDB wrapper for large job results and grades
│
├── medtranslate-backend/         # FastAPI backend service
│   ├── app/
│   │   ├── main.py               # FastAPI app, CORS, endpoints
│   │   ├── jobs.py               # Job store (memory + SQLite), translation cache, background execution
│   │   ├── metrics.py            # SacreBLEU, NLTK METEOR, BERTScore (subprocess)
│   │   ├── translate.py          # OpenAI / Anthropic translation with retry, effort handling
│   │   ├── schemas.py            # Pydantic request/response models
│   │   └── config.py             # Environment variable configuration
│   ├── bertscore_worker.py       # BERTScore subprocess (keeps torch out of the API process)
│   ├── requirements.txt          # Python dependencies
│   ├── Dockerfile                # Docker build for Render deployment
│   ├── .env.example              # Environment variable template
│   └── README.md                 # Backend-specific documentation
│
├── scripts/                      # Python offline pipelines
│   ├── build_dataset.py          # Corpus unification (ClinSpEn + UMass → CSV)
│   ├── translate_batch.py        # Headless batch translation runner
│   └── metrics/
│       ├── compute_all.py        # Standalone research-grade metrics
│       └── requirements.txt      # Python dependencies for metrics pipeline
│
├── data/                         # Dataset directory (gitignored except .gitkeep)
│   └── .gitkeep
│
├── package.json                  # Node.js dependencies and scripts
├── .env.example                  # Frontend environment variable template
├── tsconfig.json                 # TypeScript configuration
├── tailwind.config.ts            # Tailwind CSS theme with clinical colors
├── postcss.config.js             # PostCSS plugins
└── next.config.ts                # Next.js configuration (10MB body limit)
```

## Data Flow

### Job-Based Translation Pipeline

```
Upload Page                  Backend (FastAPI)
───────────                  ────────────────
CSV/XLSX file
    │
    ▼
parseCSV() / XLSX → backend
    │
    ▼
TranslationPair[]
    │
    ├──> Convert to CSV File (pairsToCSVFile)
    │
    ▼
POST /v1/jobs (multipart/form-data)
    │                          ┌──────────────────────────────────┐
    │                          │ 1. Parse CSV/XLSX                 │
    │                          │ 2. Translate (OpenAI / Anthropic) │
    │                          │    - dedupe identical source text │
    │                          │    - SQLite translation cache     │
    │                          │ 3. METEOR per sentence            │
    │                          │ 4. Corpus BLEU (overall + source) │
    │                          │ 5. BERTScore batch (opt-in)       │
    │                          │ 6. Record library versions, store │
    │                          └─────────┬────────────────────────┘
Translate Page                           │
──────────────                           │
GET /v1/jobs/{id} (polling 2s) ────────>│
    ◄── { status, progress } ◄───────────┘
    │
    ▼ (when complete)
GET /v1/jobs/{id}/results ──────────────>│
    ◄── { corpus_metrics,    ◄───────────┘
          sentence_metrics,
          library_versions,
          translation_config (model, prompt, reasoning_effort) }
    │
    ▼
IndexedDB (JobResults) + localStorage
    │
    ├──> Translate page (results table)
    ├──> Metrics page (aggregate dashboard)
    ├──> Review page (flagged pairs for grading)
    └──> Compare page (one saved result set per model id)
```

### What Triggers Clinician Review

The review queue is derived entirely in the browser from the backend's per-sentence results:

1. A row must be **reviewable**: either completed (has an `llm_english_translation` and no `error`) or **refused** (`error_kind == "refusal"`, which the backend scores as METEOR 0). Incomplete rows (`error_kind == "infrastructure"`) are not reviewable; they are retried from the Translate page.
2. The row's **METEOR score must be below the threshold**. The threshold defaults to `0.4`, is set on the Review page, is saved to the session, and is used by the Metrics page's "Flagged for Review" count.
3. Rows with no `english_reference` have no METEOR score and are never flagged.
4. **Refused rows come first** in the queue, labelled "Refused" with the provider's reason; completed rows below the threshold follow in dataset order.

BLEU and BERTScore do not affect flagging. The threshold is a triage heuristic, not a safety guarantee: a translation can score above it and still contain a clinically significant error.

### How Failures Are Classified and Scored

`translate.classify_error()` sorts every translation failure into two classes, recorded on the row as `error_kind` with the exact message in `error`:

| Class | Raised for | Scoring | Recovery |
|---|---|---|---|
| `refusal` (`TranslationRefused`) | Provider content filter, explicit decline (`stop_reason: refusal`), empty reply | METEOR 0, BERTScore 0, empty hypothesis in corpus BLEU | Physician review (top of queue) |
| `infrastructure` | Rate limit exhausted after retries, connection error, provider 5xx, bad request, output limit reached before any text | Not scored | "Retry incomplete rows" on the Translate page |
| `excluded` | Set by a reviewer on the Review page when a refusal was legitimate; sent on the next metrics-only re-score | Not scored, out of corpus BLEU | "Undo exclusion" on the Review page |

The retry flow is three backend jobs driven by the frontend: translate only the incomplete rows as fresh input, merge the new rows into the saved result set by `pair_id`, then submit the merged set in `metrics_only` mode (with `error`/`error_kind` columns so refused rows keep their status) so corpus BLEU and the averages cover every row.

`app/output_checks.py: detect_format_warning()` runs on every successful reply and records a `format_warning` when the reply looks wrapped (preamble, translator's note, quotation marks, markdown, extra paragraphs). It never modifies the text; the study scores raw output.

### What the Frontend Does NOT Do

- Does NOT call OpenAI directly
- Does NOT compute BLEU (no client-side BLEU)
- Does NOT compute METEOR (no client-side METEOR)
- Does NOT compute BERTScore or any proxy
- Does NOT approximate any evaluation metric
- Does NOT parse XLSX files (XLSX parsing moved to backend for security)

All metric values displayed in the UI come directly from the backend JSON response.

### Client-Side Storage

The frontend uses a dual storage strategy:

| Store | Purpose | Size Limit |
|---|---|---|
| **localStorage** | Session metadata (job ID, file name, system prompt, row limit, grades) | ~5 MB |
| **IndexedDB** | Large objects (full job results, grades backup) | Quota-based (typically 50MB+) |

`lib/session.ts` manages localStorage. `lib/idb.ts` manages IndexedDB with the database name `medtranslate` and a single `session` object store.

## Design System

MedTranslate includes a token-based design system in `src/design-system/`:

- **tokens.css**: All visual values as CSS custom properties (colors, shadows, radii, fonts)
- **theme.css**: Dark mode overrides via `[data-theme="dark"]` selector, plus transition and animation definitions
- **Primitives**: Card, Button, Badge, MetricValue, ProgressBar, GradeRow, SectionLabel, PageHeader, ThemeProvider

Theme is toggled via the Header component and persisted to localStorage key `medtranslate-theme`. All components reference CSS variables — no hard-coded colors in component code.

See [SYSTEMS_DESIGN.md](SYSTEMS_DESIGN.md) for the full design specification.

## Key Design Decisions

### Backend as Single Source of Truth

All translation calls and metric computations happen server-side in the Python backend. This ensures reproducibility, security, and publication-grade accuracy.

### Job-Based Processing

The backend uses async background tasks to process jobs without blocking the API thread. This supports datasets with thousands of rows. Jobs can be cancelled via `POST /v1/jobs/{id}/cancel`.

### Job Store: Memory plus SQLite

Active jobs live in memory, and every status change and final result is also written to SQLite (`DATABASE_PATH`, default `/data/medtranslate.db`). This lets a job survive a restart and lets a second backend instance answer polls for a job it is not executing. Terminal jobs older than seven days are deleted at startup. If the database path is not writable the backend falls back to memory only.

### Translation Cache and Metric Cache

Each unique source text is translated once per job (identical rows share one API call), and the result is stored in a SQLite `translation_cache` table keyed on `(model, system_prompt, temperature, reasoning_effort, source_text)`. Reads happen in one batched query before translation and writes in one transaction per chunk. A later job with the same key reuses the stored translation instead of calling the provider.

A second table, `metric_cache`, stores METEOR and BERTScore per `(candidate, reference)` pair, so any re-score (BERTScore-only, retry, reviewer override) only computes rows that are new. The BERTScore subprocess keeps its HuggingFace model cache next to the database (`HF_HOME`) so the model is downloaded once per deployment. See [PERFORMANCE_AND_RELIABILITY.md](PERFORMANCE_AND_RELIABILITY.md).

Consequences for study design:

- Re-running the same file with the same model and settings returns byte-identical translations. This is a cache hit, not evidence that the model is deterministic.
- Changing the prompt, the model, or the effort setting produces a new key and fresh API calls.
- To force fresh translations with unchanged settings, delete the `translation_cache` rows or point `DATABASE_PATH` at a new file.

### Reasoning Effort Is Recorded

The effort actually sent to the provider (`OPENAI_REASONING_EFFORT` or `ANTHROPIC_EFFORT`, both `medium` by default) is stored on the job as `translation_config.reasoning_effort`, returned with results, and shown on the Compare page. Temperature is handled the same way: `translation_config.temperature` is `0.0` only when it was actually sent (older OpenAI chat models) and `null` when the model rejects it (GPT-5.x reasoning models, current Claude models). The backend never claims deterministic decoding for a model that did not receive a temperature.

### Client-Side Clinical Grading

Clinical significance grades (0–3) are assigned by physicians in the browser and stored in both localStorage and IndexedDB, independent of backend metrics.

### IndexedDB for Large Data

Job results for large datasets exceed localStorage's ~5 MB limit. IndexedDB provides quota-based storage that handles datasets with thousands of rows.

### Server-Side XLSX Parsing

XLSX file parsing was moved from the frontend to the backend to address a security vulnerability in client-side Excel libraries. The backend uses openpyxl for safe XLSX parsing.

### Token-Based Theming

All visual values (colors, shadows, radii) are defined as CSS custom properties. Dark mode is implemented via a `[data-theme="dark"]` CSS selector that overrides the same tokens, rather than conditional JS logic.

## Deployment

### Frontend (Vercel)

- **Build**: `npm run build`
- **Environment**: Set `NEXT_PUBLIC_BACKEND_URL` to the Render backend URL

### Backend (Render)

- **Dockerfile**: Python 3.11, installs dependencies, downloads NLTK data
- **Environment**: Set `OPENAI_API_KEY` and `CORS_ORIGINS`
- **Port**: 8000
- **Model**: BERTScore uses `roberta-base` (switched from default for Render memory stability)
