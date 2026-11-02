# MedTranslate Backend

FastAPI backend for research-grade clinical translation evaluation.

All translations and metric computations run server-side. The frontend never calls OpenAI directly and never computes BLEU, METEOR, or BERTScore.

## Quick Start

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download NLTK data
python -m nltk.downloader wordnet omw-1.4 punkt punkt_tab

# Set environment variables
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# Run the server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Docker

```bash
docker build -t medtranslate-backend .
docker run -p 8000:8000 -e OPENAI_API_KEY=sk-... medtranslate-backend
```

## Project Structure

```
medtranslate-backend/
├── app/
│   ├── main.py           # FastAPI app, CORS, all endpoints
│   ├── jobs.py           # In-memory job store, async background execution
│   ├── metrics.py        # SacreBLEU corpus BLEU, NLTK METEOR, BERTScore
│   ├── translate.py      # OpenAI translation with retry and rate-limit handling
│   ├── schemas.py        # Pydantic request/response models
│   ├── config.py         # Environment variable configuration
│   └── __init__.py
├── worker.py             # Standalone worker entry point
├── requirements.txt      # Python dependencies
├── Dockerfile            # Docker build for Render deployment
├── .env.example          # Environment variable template
└── README.md             # This file
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/jobs` | Submit CSV/XLSX + config, returns `job_id` |
| GET | `/v1/jobs/{job_id}` | Poll job status and progress |
| GET | `/v1/jobs/{job_id}/results` | Get full results with metrics |
| POST | `/v1/jobs/{job_id}/cancel` | Cancel a running job |

### File Upload

The `POST /v1/jobs` endpoint accepts both CSV and XLSX files via multipart form upload. XLSX files are parsed server-side using `openpyxl`. The required column is `spanish_source`.

### Job Lifecycle

```
queued → running → complete
                 → failed
                 → cancelled (via POST /cancel)
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for translations |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins |
| `ANTHROPIC_API_KEY` | For Claude | — | Anthropic API key (required to run Claude Sonnet 5.5) |
| `DEFAULT_MODEL` | No | `gpt-5.6-sol` | Default model (`gpt-5.6-sol` or `claude-sonnet-5-5`) |
| `OPENAI_REASONING_EFFORT` | No | `medium` | `reasoning_effort` for GPT-5.x/GPT-6 models (`none`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `ANTHROPIC_EFFORT` | No | `medium` | `output_config.effort` for Claude 4.6+ models (`low`, `medium`, `high`, `xhigh`, `max`) |
| `REASONING_HEADROOM_TOKENS` | No | `4096` | Extra output tokens reserved for reasoning on top of `max_tokens` |

## Metrics

| Metric | Library | Notes |
|---|---|---|
| Corpus BLEU | sacrebleu | 13a tokenization, signature reported |
| METEOR | NLTK | WordNet + Porter stemming + alignment penalty |
| BERTScore F1 | bert-score | `roberta-base`, `rescale_with_baseline=True`, lazy-loaded |

Library versions are recorded with every job result for reproducibility.

## Deployment (Render)

1. Create a new Web Service on Render
2. Connect to this repository
3. Set the root directory to `medtranslate-backend`
4. Set environment: Docker
5. Add environment variable: `OPENAI_API_KEY`
6. Add `CORS_ORIGINS` with your Vercel frontend URL
