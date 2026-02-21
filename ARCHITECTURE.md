# Architecture

This document describes the system architecture of MedTranslate, a clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.

## Overview

MedTranslate uses a **two-service architecture**: a Next.js frontend deployed to Vercel and a FastAPI backend deployed to Render. All translation and metric computation occurs server-side in the Python backend. The frontend handles file upload, job submission, progress polling, and result visualization.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MedTranslate                                     │
│                                                                          │
│  Frontend (Next.js — Vercel)              Backend (FastAPI — Render)     │
│  ┌─────────────┐                          ┌─────────────────────────┐   │
│  │   Upload     │── CSV upload ──────────>│ POST /v1/jobs           │   │
│  │  (page.tsx)  │                         │  ├── Parse CSV          │   │
│  └──────┬──────┘                          │  ├── OpenAI translate   │   │
│         │                                  │  ├── SacreBLEU (corpus)│   │
│  ┌──────▼──────┐                          │  ├── NLTK METEOR       │   │
│  │  Translate   │── Poll status ────────> │  ├── BERTScore          │   │
│  │(translate/) │<── JSON results ────────│  └── Return results     │   │
│  └──────┬──────┘                          └─────────────────────────┘   │
│         │                                          │                     │
│  ┌──────▼──────┐                          ┌────────▼────────────────┐   │
│  │   Review     │                         │     OpenAI API          │   │
│  │  (review/)  │                          │     (GPT models)        │   │
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
| **Fonts** | IBM Plex Sans / IBM Plex Mono | Typography via Google Fonts |
| **File Parsing** | PapaParse, xlsx | CSV and XLSX file parsing in the browser |
| **Backend Framework** | FastAPI | Async Python API with auto-generated OpenAPI docs |
| **LLM Provider** | OpenAI Python SDK | Server-side translation (API key never in frontend) |
| **Corpus BLEU** | sacrebleu | Corpus-level BLEU with default 13a tokenization |
| **METEOR** | NLTK meteor_score | Full WordNet + Porter stemming + alignment penalty |
| **BERTScore** | bert-score (HuggingFace) | Contextual embeddings with rescale_with_baseline=True |
| **Deployment** | Vercel (frontend) + Render (backend) | Production hosting |

## Directory Structure

```
medtranslate/
├── app/                          # Next.js App Router (pages only — no API routes)
│   ├── layout.tsx                # Root HTML layout, metadata, fonts
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
│   ├── Header.tsx                # Top navigation bar with workflow tabs
│   ├── MetricsCard.tsx           # Metric value display card
│   ├── PairDetail.tsx            # Three-column translation detail panel
│   ├── GradeSelector.tsx         # Clinical significance grade buttons (0–3)
│   └── StatusPill.tsx            # Row status badge
│
├── lib/                          # Shared non-UI logic
│   ├── types.ts                  # TypeScript interfaces (frontend + backend types)
│   ├── api.ts                    # Backend API client (submitJob, pollStatus, fetchResults)
│   ├── metrics.ts                # Display helpers (summarizeMetric only — no computation)
│   ├── csv.ts                    # CSV/XLSX parsing, CSV export, pairsToCSVFile
│   └── session.ts                # localStorage-based session state persistence
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
├── tailwind.config.ts            # Tailwind CSS theme
├── postcss.config.js             # PostCSS plugins
├── next.config.ts                # Next.js configuration
└── README.md                     # Project overview and quick start
```

## Data Flow

### Job-Based Translation Pipeline

```
Upload Page                  Backend (FastAPI)
───────────                  ────────────────
CSV/XLSX file
    │
    ▼
parseCSV() / parseXLSX()
    │
    ▼
TranslationPair[]
    │
    ├──> Convert to CSV File (pairsToCSVFile)
    │
    ▼
POST /v1/jobs (multipart/form-data)
    │                          ┌─────────────────────────┐
    │                          │ 1. Parse CSV             │
    │                          │ 2. Translate (OpenAI)    │
    │                          │ 3. METEOR per sentence   │
    │                          │ 4. BERTScore batch       │
    │                          │ 5. Corpus BLEU           │
    │                          │ 6. Store results         │
    │                          └─────────┬───────────────┘
Translate Page                           │
──────────────                           │
GET /v1/jobs/{id} (polling) ────────────>│
    ◄── { status, progress } ◄───────────┘
    │
    ▼ (when complete)
GET /v1/jobs/{id}/results ──────────────>│
    ◄── { corpus_metrics,    ◄───────────┘
          sentence_metrics,
          library_versions }
    │
    ▼
localStorage (JobResults)
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

All metric values displayed in the UI come directly from the backend JSON response.

## Key Design Decisions

### Backend as Single Source of Truth

All translation calls and metric computations happen server-side in the Python backend. This ensures reproducibility, security, and publication-grade accuracy.

### Job-Based Processing

The backend uses async background tasks to process jobs without blocking the API thread. This supports datasets with thousands of rows.

### In-Memory Job Store (MVP)

Jobs are stored in memory. For production scale-out, replace with Redis or a database-backed store.

### Client-Side Clinical Grading

Clinical significance grades (0–3) are assigned by physicians in the browser and stored in localStorage, independent of backend metrics.

## Deployment

### Frontend (Vercel)

- **Build**: `npm run build`
- **Environment**: Set `NEXT_PUBLIC_BACKEND_URL` to the Render backend URL

### Backend (Render)

- **Dockerfile**: Python 3.11, installs dependencies, downloads NLTK data
- **Environment**: Set `OPENAI_API_KEY` and `CORS_ORIGINS`
- **Port**: 8000
