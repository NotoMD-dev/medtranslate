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
│  │   Review     │                         │     OpenAI API          │   │
│  │  (review/)  │                          │     (GPT-4o)            │   │
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
│   └── metrics/
│       └── page.tsx              # "/metrics" — Aggregate metrics dashboard
│
├── components/                   # Shared React components
│   ├── Header.tsx                # Top navigation bar with workflow tabs and theme toggle
│   ├── MetricsCard.tsx           # Metric value display card
│   ├── PairDetail.tsx            # Three-column translation detail panel
│   ├── GradeSelector.tsx         # Clinical significance grade buttons (0–3)
│   └── StatusPill.tsx            # Row status badge
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
│   │   ├── jobs.py               # Job store, background execution
│   │   ├── metrics.py            # SacreBLEU, NLTK METEOR, BERTScore
│   │   ├── translate.py          # OpenAI translation with retry
│   │   ├── schemas.py            # Pydantic request/response models
│   │   └── config.py             # Environment variable configuration
│   ├── worker.py                 # Standalone worker entry point
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
    │                          ┌─────────────────────────┐
    │                          │ 1. Parse CSV/XLSX        │
    │                          │ 2. Translate (OpenAI)    │
    │                          │ 3. METEOR per sentence   │
    │                          │ 4. BERTScore batch       │
    │                          │ 5. Corpus BLEU           │
    │                          │ 6. Store results         │
    │                          └─────────┬───────────────┘
Translate Page                           │
──────────────                           │
GET /v1/jobs/{id} (polling 2s) ────────>│
    ◄── { status, progress } ◄───────────┘
    │
    ▼ (when complete)
GET /v1/jobs/{id}/results ──────────────>│
    ◄── { corpus_metrics,    ◄───────────┘
          sentence_metrics,
          library_versions }
    │
    ▼
IndexedDB (JobResults) + localStorage
    │
    ├──> Translate page (results table)
    ├──> Metrics page (aggregate dashboard)
    └──> Review page (flagged pairs for grading)
```

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

### In-Memory Job Store (MVP)

Jobs are stored in memory. For production scale-out, replace with Redis or a database-backed store.

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
