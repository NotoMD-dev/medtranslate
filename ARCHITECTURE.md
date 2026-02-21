# Architecture

This document describes the system architecture of MedTranslate, a clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.

## Overview

MedTranslate is a **Next.js 15** web application with a Python-based offline processing pipeline. It follows a linear, stage-based research workflow:

1. **Dataset preparation** (offline Python script)
2. **Upload and configuration** (web UI)
3. **Batch translation** (web UI + server-side API route)
4. **Automated scoring** (client-side JavaScript + optional offline Python)
5. **Clinical review and adjudication** (web UI)
6. **Aggregate metrics dashboard** (web UI)

```
┌───────────────────────────────────────────────────────────────────┐
│                         MedTranslate                              │
│                                                                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────┐   ┌──────────┐ │
│  │   Upload     │──>│  Translate   │──>│ Review  │──>│ Metrics  │ │
│  │  (page.tsx)  │   │(translate/) │   │(review/)│   │(metrics/)│ │
│  └─────────────┘   └──────┬──────┘   └─────────┘   └──────────┘ │
│                           │                                       │
│                    ┌──────▼──────┐                                │
│                    │ /api/translate│                               │
│                    │  (route.ts)  │                                │
│                    └──────┬──────┘                                │
│                           │                                       │
│              ┌────────────┴────────────┐                         │
│              ▼                         ▼                         │
│     ┌────────────────┐       ┌─────────────────┐                │
│     │  OpenAI API     │       │  Anthropic API   │               │
│     │  (GPT models)   │       │  (Claude models) │               │
│     └────────────────┘       └─────────────────┘                │
└───────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | Server-side rendering, API routes, file-based routing |
| **Language** | TypeScript 5.9 | Type-safe frontend and API code |
| **UI** | React 19, Tailwind CSS 3.4 | Component-based UI with utility-first styling |
| **Fonts** | IBM Plex Sans / IBM Plex Mono | Typography via Google Fonts |
| **Icons** | Lucide React | Icon library (available but minimally used) |
| **File Parsing** | PapaParse, xlsx | CSV and XLSX file parsing in the browser |
| **LLM Providers** | OpenAI SDK, Anthropic SDK | Server-side translation API calls |
| **Offline Scripts** | Python 3.10+ | Dataset preparation, batch translation, research-grade metrics |
| **NLP Libraries** | NLTK, bert-score, PyTorch, pandas | Publication-quality BLEU, METEOR, and BERTScore computation |

## Directory Structure

```
medtranslate/
├── app/                          # Next.js App Router (pages + API)
│   ├── layout.tsx                # Root HTML layout, metadata, fonts
│   ├── globals.css               # Global styles, CSS variables, animations
│   ├── page.tsx                  # "/" — Upload & configuration page
│   ├── translate/
│   │   └── page.tsx              # "/translate" — Batch translation runner
│   ├── review/
│   │   └── page.tsx              # "/review" — Clinical safety review
│   ├── metrics/
│   │   └── page.tsx              # "/metrics" — Aggregate metrics dashboard
│   └── api/
│       └── translate/
│           └── route.ts          # POST /api/translate — LLM translation endpoint
│
├── components/                   # Shared React components
│   ├── Header.tsx                # Top navigation bar with workflow tabs
│   ├── MetricsCard.tsx           # Metric value display card
│   ├── PairDetail.tsx            # Side-by-side translation detail panel
│   ├── GradeSelector.tsx         # Clinical significance grade buttons (0–3)
│   └── StatusPill.tsx            # Row status badge (pending/translating/complete/error)
│
├── lib/                          # Shared non-UI logic
│   ├── types.ts                  # TypeScript interfaces, constants, defaults
│   ├── metrics.ts                # Client-side BLEU, METEOR, BERTProxy computation
│   ├── csv.ts                    # CSV/XLSX parsing and CSV export utilities
│   └── session.ts                # localStorage-based session state persistence
│
├── scripts/                      # Python offline pipelines
│   ├── build_dataset.py          # Corpus unification (ClinSpEn + UMass → CSV)
│   ├── translate_batch.py        # Headless batch translation runner
│   └── metrics/
│       ├── compute_all.py        # Research-grade BLEU, METEOR, BERTScore
│       └── requirements.txt      # Python dependencies for metrics pipeline
│
├── data/                         # Dataset directory (gitignored except .gitkeep)
│   └── .gitkeep
│
├── package.json                  # Node.js dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── tailwind.config.ts            # Tailwind CSS theme (custom colors, fonts)
├── postcss.config.js             # PostCSS plugins (autoprefixer)
├── next.config.ts                # Next.js configuration (body size limit)
├── .gitignore                    # Ignored files (data, env, build artifacts)
├── .env.example                  # Environment variable template
├── LICENSE                       # MIT License
└── README.md                     # Project overview and quick start
```

## Component Architecture

### Page Components

Each page is a client-side React component (`"use client"`) that manages its own state and reads/writes to the shared session store.

| Page | Route | Responsibility |
|---|---|---|
| `UploadPage` | `/` | File upload (CSV/XLSX), system prompt configuration, row limit selection |
| `TranslatePage` | `/translate` | Sequential batch translation, progress tracking, per-row metric scoring |
| `ReviewPage` | `/review` | Surfaces pairs with BLEU < 0.4 for physician adjudication |
| `MetricsPage` | `/metrics` | Aggregate metric summaries, grade distributions, source-level comparisons |

### Shared Components

| Component | Used By | Purpose |
|---|---|---|
| `Header` | All pages | Persistent navigation bar with Upload/Translate/Review/Metrics tabs |
| `MetricsCard` | MetricsPage | Displays a single metric (label, mean value, sample count) |
| `PairDetail` | TranslatePage | Three-column detail view (Spanish source, English reference, LLM translation) with metric scores and grade selector |
| `GradeSelector` | PairDetail | Four-button control for assigning clinical significance grades 0–3 |
| `StatusPill` | TranslatePage | Colored badge showing row processing status |

## Data Flow

### Session State

All application state is persisted in the browser's `localStorage` via `lib/session.ts`. There is no server-side database. The session store uses four keys:

| Key | Type | Contents |
|---|---|---|
| `medtranslate:data` | `TranslationPair[]` | Uploaded dataset rows |
| `medtranslate:prompt` | `string` | Active system prompt |
| `medtranslate:rowLimit` | `number` | Optional row limit |
| `medtranslate:results` | `TranslationResult[]` | Translation results with metrics and grades |

### Translation Pipeline (Web)

```
Upload Page                  Translate Page                    API Route
───────────                  ──────────────                    ─────────
CSV/XLSX file
    │
    ▼
parseCSV() / parseXLSX()
    │
    ▼
TranslationPair[]
    │
    ├──> localStorage ──> Read from localStorage
                              │
                              ▼
                         For each row:
                              │
                              ├── POST /api/translate ───────> Route handler
                              │     { text, systemPrompt,      │
                              │       model }                   ├── if model starts
                              │                                 │   with "claude":
                              │                                 │   → Anthropic API
                              │                                 │
                              │                                 ├── otherwise:
                              │                                 │   → OpenAI API
                              │                                 │
                              ◄── { translation } ◄────────────┘
                              │
                              ▼
                         computeAllMetrics()
                         (BLEU, METEOR, BERTProxy)
                              │
                              ▼
                         TranslationResult[]
                              │
                              ▼
                         localStorage
```

### Offline Pipeline (Python)

```
Source Corpora
────────────
ClinSpEn .en/.es files ──┐
                          ├──> build_dataset.py ──> unified_translation_dataset.csv
UMass EHR pairs.txt ──────┘

unified_translation_dataset.csv
    │
    ▼
translate_batch.py ──> results_with_translations.csv
    │
    ▼
compute_all.py ──> results_with_metrics.csv
    (BLEU, METEOR, BERTScore P/R/F1)
```

## Key Design Decisions

### Client-Side State (No Database)

MedTranslate uses `localStorage` instead of a database. This simplifies deployment and keeps the tool self-contained for individual researcher use. The tradeoff is that data does not persist across browsers or devices, and `localStorage` has a ~5 MB limit (sufficient for metadata but not raw datasets of thousands of rows with full text).

### Dual Metric Implementations

Translation metrics exist in two forms:

- **Client-side (TypeScript)**: Fast, approximate implementations in `lib/metrics.ts` for immediate feedback during the translation workflow. BERTProxy uses n-gram cosine similarity, not actual BERT embeddings.
- **Server-side (Python)**: Publication-quality implementations in `scripts/metrics/compute_all.py` using NLTK and the `bert_score` library with real transformer embeddings.

This dual approach balances interactive responsiveness with research rigor.

### Sequential Translation Execution

Translations run sequentially (one row at a time) rather than in parallel. This avoids rate-limiting from LLM providers and allows the UI to show real-time progress. Each row transitions through states: `pending` → `translating` → `scoring` → `complete` (or `error`).

### Provider Routing

The API route (`app/api/translate/route.ts`) inspects the `model` parameter to determine the provider. Models starting with `"claude"` route to the Anthropic API; all others route to OpenAI. Both providers use raw `fetch()` calls rather than their respective SDKs for the API route, keeping the server-side code lightweight.

## Deployment

MedTranslate is a standard Next.js application deployable to any Node.js hosting environment:

- **Development**: `npm run dev` (port 3000)
- **Production build**: `npm run build && npm start`
- **Environment variables**: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` must be set in `.env.local`
- **Body size limit**: Configured to 10 MB in `next.config.ts` for large dataset uploads
