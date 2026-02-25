# MedTranslate

**A clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.**

MedTranslate is the research instrument for a study evaluating whether large language models can produce clinically accurate and safe English translations of Spanish medical text. It combines server-side batch LLM translation, research-grade automated metrics (corpus BLEU, METEOR, BERTScore), and a physician-adjudicated clinical significance grading framework.

## Features

- **Batch translation** — Upload CSV/XLSX datasets of up to thousands of rows; translations run server-side via OpenAI GPT-4o
- **Publication-grade metrics** — Corpus BLEU (sacrebleu), sentence-level METEOR (NLTK with WordNet + stemming), BERTScore F1 (bert-score with rescaled baselines)
- **Clinical significance grading** — Physician review workflow with a 0–3 severity scale for flagged translations (METEOR < threshold)
- **Light / Dark theme** — Toggle between calm academic light mode and dark mode
- **Design system** — Token-based primitives (Card, Button, Badge, MetricValue, ProgressBar, GradeRow) for consistent UI
- **Session persistence** — localStorage + IndexedDB for large datasets that survive page reloads
- **Job cancellation** — Abort running translation jobs mid-flight
- **CSV/XLSX export** — Download results with all metrics and clinical grades

## Architecture

MedTranslate uses a two-service architecture:

- **Frontend** (Next.js 15 / React 19, deployed to Vercel): File upload, job submission, progress polling, result visualization, clinical grading, theme toggle
- **Backend** (FastAPI, deployed to Render): Translation via OpenAI, corpus BLEU via sacrebleu, METEOR via NLTK, BERTScore via bert-score, XLSX parsing via openpyxl

All translation and metric computation occurs server-side. The frontend never calls OpenAI directly and never computes metrics.

```
medtranslate/
├── app/                          # Next.js pages (Upload, Translate, Review, Metrics)
│   ├── layout.tsx                # Root layout with metadata and fonts
│   ├── globals.css               # Global styles, animations, CSS variables
│   ├── page.tsx                  # Upload page
│   ├── translate/page.tsx        # Translation job page
│   ├── review/page.tsx           # Clinical review page
│   └── metrics/page.tsx          # Aggregate metrics dashboard
├── components/                   # Shared React components
│   ├── Header.tsx                # Navigation bar with theme toggle
│   ├── PairDetail.tsx            # Three-column translation detail panel
│   ├── GradeSelector.tsx         # Clinical grade buttons (0–3)
│   ├── MetricsCard.tsx           # Metric value display card
│   └── StatusPill.tsx            # Row status badge
├── src/design-system/            # Design tokens and UI primitives
│   ├── tokens.css                # CSS custom properties (light defaults)
│   ├── theme.css                 # Dark mode overrides + animations
│   ├── index.ts                  # Barrel exports
│   └── primitives/               # Card, Button, Badge, MetricValue, etc.
├── lib/                          # Frontend utilities
│   ├── types.ts                  # TypeScript interfaces
│   ├── api.ts                    # Backend API client
│   ├── csv.ts                    # CSV/XLSX parsing and export
│   ├── session.ts                # localStorage persistence
│   ├── idb.ts                    # IndexedDB for large datasets
│   └── metrics.ts                # Display helpers (no computation)
├── medtranslate-backend/         # FastAPI backend service
│   ├── app/
│   │   ├── main.py               # API endpoints
│   │   ├── jobs.py               # Job store and async execution
│   │   ├── metrics.py            # SacreBLEU, NLTK METEOR, BERTScore
│   │   ├── translate.py          # OpenAI translation with retry
│   │   ├── schemas.py            # Pydantic models
│   │   └── config.py             # Environment configuration
│   ├── Dockerfile                # Docker build for Render
│   └── requirements.txt          # Python dependencies
├── scripts/                      # Offline Python pipelines
│   ├── build_dataset.py          # Corpus unification
│   ├── translate_batch.py        # Headless batch translation
│   └── metrics/                  # Standalone metrics pipeline
└── data/                         # Dataset directory (gitignored)
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- An OpenAI API key

### 1. Clone and install frontend

```bash
git clone https://github.com/NotoMD-dev/medtranslate.git
cd medtranslate
npm install
```

### 2. Set up frontend environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 3. Set up and run the backend

```bash
cd medtranslate-backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt

# Download NLTK data
python -m nltk.downloader wordnet omw-1.4 punkt punkt_tab

# Set environment variables
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# Run the backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Run the frontend

```bash
# In the root directory
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload your CSV dataset.

### 5. (Optional) Docker for backend

```bash
cd medtranslate-backend
docker build -t medtranslate-backend .
docker run -p 8000:8000 -e OPENAI_API_KEY=sk-... medtranslate-backend
```

## Deployment

### Frontend (Vercel)

1. Connect the repository to Vercel
2. Set environment variable: `NEXT_PUBLIC_BACKEND_URL=https://your-backend.onrender.com`
3. Deploy

### Backend (Render)

1. Create a new Web Service on Render
2. Set the root directory to `medtranslate-backend`
3. Set environment: Docker
4. Add environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `CORS_ORIGINS`: Your Vercel frontend URL (e.g., `https://medtranslate.vercel.app`)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/jobs` | Submit CSV/XLSX + config, returns `job_id` |
| GET | `/v1/jobs/{job_id}` | Poll job status and progress |
| GET | `/v1/jobs/{job_id}/results` | Get full results with metrics |
| POST | `/v1/jobs/{job_id}/cancel` | Cancel a running job |

See [API_SPEC.md](API_SPEC.md) for full request/response documentation.

## Metrics

All metrics are computed server-side using reference Python implementations:

| Metric | Library | Details |
|--------|---------|---------|
| **Corpus BLEU** | sacrebleu | Default 13a tokenization, signature reported |
| **METEOR** | NLTK | WordNet synonyms + Porter stemming + alignment penalty |
| **BERTScore F1** | bert-score | `rescale_with_baseline=True`, roberta-base model |

Library versions are recorded with every job for reproducibility. See [METRICS_VALIDATION.md](METRICS_VALIDATION.md) for implementation details.

## Clinical Significance Scale

Physician-adjudicated grading of translation discrepancies:

| Grade | Classification | Definition |
|---|---|---|
| 0 | No error | LLM translation accurately preserves clinical meaning |
| 1 | Minor linguistic error | Stylistic or grammatical difference, no change in clinical meaning |
| 2 | Moderate error | Potential for confusion, unlikely to change clinical management |
| 3 | Clinically significant | Could alter diagnosis, treatment, or disposition |

Translations with METEOR < 0.4 (configurable threshold) are flagged for physician review.

## Study Context

This tool supports a corpus-based evaluation study using 6,876 sentence-aligned Spanish-English medical text pairs from two sources:

- **ClinSpEn Corpus** (3,934 pairs): Professionally translated COVID-19 clinical case reports (CC-BY-4.0)
- **UMass EHR Pairs** (2,942 pairs): De-identified electronic health record clinical notes (CC-BY-NC-4.0)

## Environment Variables

### Frontend

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Yes | URL of the FastAPI backend |

### Backend

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key (never exposed to frontend) |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `DEFAULT_MODEL` | No | Default model (defaults to `gpt-4o`) |

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, tech stack |
| [SYSTEMS_DESIGN.md](SYSTEMS_DESIGN.md) | UI/UX design specification, design tokens, component library |
| [API_SPEC.md](API_SPEC.md) | REST API endpoints and request/response formats |
| [DATA_SCHEMA.md](DATA_SCHEMA.md) | TypeScript interfaces, Pydantic models, CSV/storage schemas |
| [SECURITY.md](SECURITY.md) | API key management, data handling, deployment checklist |
| [METRICS_VALIDATION.md](METRICS_VALIDATION.md) | Metric implementations, clinical grading framework |
| [CHANGELOG.md](CHANGELOG.md) | Version history and migration notes |

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript 5.9, Tailwind CSS 3.4 |
| Design System | CSS custom properties, Token-based primitives |
| Icons | Lucide React |
| Storage | localStorage + IndexedDB |
| Backend | FastAPI, Python 3.11+ |
| Translation | OpenAI Python SDK (GPT-4o) |
| Metrics | sacrebleu, NLTK, bert-score, PyTorch |
| Deployment | Vercel (frontend) + Render (backend) |

## License

MIT
