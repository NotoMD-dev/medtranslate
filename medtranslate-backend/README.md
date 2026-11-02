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
│   ├── jobs.py           # Job store (memory + SQLite), translation cache, async execution
│   ├── metrics.py        # SacreBLEU corpus BLEU, NLTK METEOR, BERTScore (via subprocess)
│   ├── translate.py      # OpenAI / Anthropic translation with retry, effort handling, failure classes
│   ├── output_checks.py  # Heuristic format warnings on raw replies (never modifies text)
│   ├── schemas.py        # Pydantic request/response models
│   ├── config.py         # Environment variable configuration
│   └── __init__.py
├── bertscore_worker.py   # BERTScore subprocess entry point
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

The `POST /v1/jobs` endpoint accepts both CSV and XLSX files via multipart form upload. XLSX files are parsed server-side using `openpyxl`. The source column is detected from the known language columns (`spanish_source`, `french_source`, …, or `source_text`) or passed explicitly as `source_column`.

### Translation Settings Recorded With Results

`GET /v1/jobs/{id}/results` returns `translation_config` with the model, system prompt, `temperature`, `max_tokens`, and `reasoning_effort`. `reasoning_effort` is the value of `OPENAI_REASONING_EFFORT` or `ANTHROPIC_EFFORT` that was in force when the job ran (`null` for models that take no effort setting). `temperature` is the value actually sent: `0.0` for older OpenAI chat models, `null` for current GPT-5.x and Claude models, which reject the parameter. A `null` run is not guaranteed to be deterministic; the translation cache, not the model, is what makes re-runs identical.

### Failure Handling

Every failed row keeps the exact provider message in `error` and a class in `error_kind`:

- `refusal` (`TranslationRefused`): content filter, explicit decline, or empty reply. Scored as METEOR 0 / BERTScore 0 with an empty hypothesis in corpus BLEU, and counted in `refused_rows`.
- `infrastructure`: rate limit exhausted after 6 retries, connection error, provider 5xx, bad request, or output limit reached before any text. Not scored; counted in `incomplete_rows`.
- `excluded`: a refusal a reviewer judged legitimate, submitted on a metrics-only re-score. Not scored, out of corpus BLEU; counted in `excluded_rows`. The frontend can resubmit just these rows and then re-score the merged set in `metrics_only` mode; the optional `error` / `error_kind` CSV columns keep refused rows' status on that re-score.

`output_checks.detect_format_warning()` records a `format_warning` on replies that look wrapped (preamble, translator's note, quotation marks, markdown, extra paragraphs). The reply text is never changed.

### Metric Cache

METEOR and BERTScore values are stored per `(candidate, reference)` pair in a `metric_cache` table. Re-scores (metrics-only jobs) reuse them and only compute rows that are new, which makes BERTScore-only runs, retries, and reviewer-override re-scores cheap. The BERTScore subprocess uses `HF_HOME=<db dir>/hf-cache` unless `HF_HOME` is set, so the model is downloaded once per deployment.

### Translation Cache

Unique source texts are translated once per job, and every translation is stored in a SQLite `translation_cache` table keyed on `(model, system_prompt, temperature, reasoning_effort, source_text)`. Later jobs with the same key reuse the stored text and make no provider call. Change any part of the key (for example the effort environment variable) to force fresh translations, or delete the table rows.

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
| `DATABASE_PATH` | No | `/data/medtranslate.db` | SQLite file for job persistence and the translation cache; memory-only if unwritable |
| `MAX_CONCURRENT_JOBS` | No | `2` | Jobs executed simultaneously |
| `MAX_CONCURRENT_TRANSLATIONS` | No | `4` | Provider calls in flight per job |
| `BERTSCORE_CHUNK_SIZE` | No | `256` | Rows per BERTScore progress chunk (clamped to 32–512) |
| `HF_HOME` | No | `<db dir>/hf-cache` | HuggingFace model cache for the BERTScore subprocess; put it on the persistent disk |
| `JOB_IDLE_TIMEOUT` | No | `300` | Seconds without a client poll before a running job is auto-cancelled (API spend protection) |

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
