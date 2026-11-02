# API Specification

This document describes the HTTP API exposed by the MedTranslate backend (FastAPI). The backend handles all translation, XLSX parsing, and metric computation. The frontend submits jobs, polls status, and fetches results.

## Base URLs

```
http://localhost:8000       (local development)
https://your-app.onrender.com  (production — Render)
```

---

## `POST /v1/jobs`

Submit a CSV or XLSX file and model configuration to start a translation + metrics job.

**Source file**: `medtranslate-backend/app/main.py`

### Request

**Content-Type**: `multipart/form-data`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | file (CSV/XLSX) | Yes | — | CSV or XLSX file with a source-language column (e.g. `spanish_source`) and `english_reference`. Optional `error` / `error_kind` columns let a metrics-only re-score keep failed rows' status. |
| `model` | string | No | `"gpt-5.6-sol"` | Model identifier (`gpt-5.6-sol` or `claude-opus-5-5`) |
| `system_prompt` | string | No | *(medical interpreter prompt)* | System prompt for the LLM |
| `temperature` | float | No | `0.0` | Accepted for compatibility but overridden: the backend sends `0.0` to models that accept temperature and omits it for models that reject it (see `translation_config.temperature` in results) |
| `max_tokens` | int | No | `1024` | Maximum tokens in the LLM response |
| `compute_bertscore` | boolean | No | `false` | Whether to compute BERTScore (requires ~400MB torch) |

**Supported file types**: `.csv`, `.xlsx`

**Required columns**: `spanish_source`

**Optional columns**: `pair_id`, `source`, `content_type`, `english_reference`, `llm_english_translation`

### Response — Success

**Status**: `202 Accepted`

```json
{
  "job_id": "a1b2c3d4e5f6"
}
```

### Response — Error

**Status**: `400 Bad Request`

```json
{
  "detail": "CSV must contain a \"spanish_source\" column"
}
```

---

## `GET /v1/jobs/{job_id}`

Poll the status and progress of a running job.

### Response — Success

**Status**: `200 OK`

```json
{
  "job_id": "a1b2c3d4e5f6",
  "status": "running",
  "phase": "translating",
  "total": 1000,
  "translated": 450,
  "scored": 320,
  "failed_rows": 2,
  "refused_rows": 1,
  "incomplete_rows": 1,
  "excluded_rows": 0,
  "error": null
}
```

| Field | Type | Description |
|---|---|---|
| `job_id` | string | The job identifier |
| `status` | string | One of: `queued`, `running`, `complete`, `failed`, `cancelled` |
| `phase` | string | What the job is doing now: `queued`, `translating`, `meteor`, `bleu`, `bertscore`, `complete`, `failed`, `cancelled`. Drives the progress bar. |
| `total` | int | Total rows in the dataset |
| `translated` | int | Rows translated so far (updated per sentence) |
| `scored` | int | Rows with METEOR computed so far (updated every 25 rows during the `meteor` phase) |
| `failed_rows` | int | Rows that failed translation (`refused_rows + incomplete_rows`) |
| `refused_rows` | int | Model declined or returned an empty reply. Scored as 0. |
| `incomplete_rows` | int | Provider or configuration failure. Not scored; retryable. |
| `excluded_rows` | int | Refusals a reviewer marked legitimate (submitted with `error_kind=excluded`). Not scored. |
| `error` | string \| null | Error message if status is `failed` |

### Response — Not Found

**Status**: `404 Not Found`

```json
{
  "detail": "Job not found"
}
```

---

## `GET /v1/jobs/{job_id}/results`

Retrieve complete results after a job finishes.

### Response — Success

**Status**: `200 OK`

```json
{
  "job_id": "a1b2c3d4e5f6",
  "status": "complete",
  "corpus_metrics": {
    "overall": {
      "bleu_score": 42.31,
      "bleu_signature": "BLEU = 42.31 65.2/48.3/37.1/29.0 (BP = 0.987 ...)"
    },
    "clinspen": {
      "bleu_score": 44.56,
      "bleu_signature": "BLEU = 44.56 ..."
    },
    "umass": {
      "bleu_score": 39.12,
      "bleu_signature": "BLEU = 39.12 ..."
    }
  },
  "sentence_metrics": [
    {
      "pair_id": "clinspen_doc1_L5",
      "source": "ClinSpEn_ClinicalCases",
      "content_type": "clinical_case_report",
      "spanish_source": "El paciente presenta dolor abdominal agudo...",
      "english_reference": "The patient presents with acute abdominal pain...",
      "llm_english_translation": "The patient presents with acute abdominal pain...",
      "meteor": 0.8723,
      "error_kind": null,
      "format_warning": null,
      "bertscore_f1": 0.9234,
      "error": null
    }
  ],
  "library_versions": {
    "sacrebleu": "2.4.3",
    "nltk": "3.9.1",
    "bert_score": "0.3.13",
    "torch": "2.5.1"
  },
  "translation_config": {
    "model": "gpt-5.6-sol",
    "system_prompt": "You are a medical interpreter...",
    "temperature": null,
    "max_tokens": 1024,
    "reasoning_effort": "medium"
  }
}
```

Per-sentence fields added in 1.5.0:

| Field | Type | Description |
|---|---|---|
| `error` | string \| null | Exact provider/translator message when the row failed |
| `error_kind` | `"refusal"` \| `"infrastructure"` \| `"excluded"` \| null | `refusal`: model declined or returned nothing; scored as 0 (METEOR 0, BERTScore 0, empty BLEU hypothesis). `infrastructure`: rate limit, connection, server, or config failure; not scored. `excluded`: a refusal a reviewer judged legitimate, submitted on a metrics-only re-score; not scored and left out of corpus BLEU. |
| `format_warning` | string \| null | Heuristic note when the reply looks wrapped (preamble, translator's note, quotation marks, markdown, extra paragraphs). The text is never modified. |

`temperature` is the value actually sent to the provider: `0.0` for older OpenAI chat models, `null` for GPT-5.x reasoning models and current Claude models, which reject the parameter. A `null` run is not guaranteed to be deterministic.

`reasoning_effort` is the thinking/reasoning effort the backend actually applied to the run (`OPENAI_REASONING_EFFORT` for GPT-5.x reasoning models, `ANTHROPIC_EFFORT` for Claude 4.6+ models). It is `null` for models that take no effort setting.

### Key Fields

| Field | Description |
|---|---|
| `corpus_metrics.overall` | Corpus-level BLEU for the entire dataset (sacrebleu) |
| `corpus_metrics.clinspen` | Corpus BLEU for ClinSpEn rows only |
| `corpus_metrics.umass` | Corpus BLEU for UMass rows only |
| `sentence_metrics[].meteor` | Per-sentence METEOR (NLTK, with WordNet + stemming) |
| `sentence_metrics[].bertscore_f1` | Per-sentence BERTScore F1 (rescaled with baseline) |
| `library_versions` | Exact library versions for reproducibility reporting |
| `translation_config` | Model and prompt configuration used for the job |

---

## `POST /v1/jobs/{job_id}/cancel`

Cancel a running translation job. Rows already translated and scored are preserved; remaining rows are skipped.

### Response — Success

**Status**: `200 OK`

```json
{
  "status": "cancelled"
}
```

### Response — Not Found

**Status**: `404 Not Found`

```json
{
  "detail": "Job not found"
}
```

---

## Environment Variables

### Backend

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key for translations |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (defaults to localhost:3000) |
| `DEFAULT_MODEL` | No | Default model name (defaults to `gpt-5.6-sol`) |
| `OPENAI_REASONING_EFFORT` | No | Reasoning effort sent as `reasoning_effort` for GPT-5.x/GPT-6 models (default `medium`) |
| `ANTHROPIC_EFFORT` | No | Effort sent as `output_config.effort` for Claude 4.6+ models (default `medium`) |
| `REASONING_HEADROOM_TOKENS` | No | Extra output tokens added to `max_tokens` for reasoning (default `4096`) |

### Frontend

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Yes | URL of the FastAPI backend |

---

## Metric Computation Details

### Corpus BLEU

- Library: `sacrebleu`
- Tokenization: 13a (default)
- Returns score and full signature string
- Computed for: overall, ClinSpEn-only, UMass-only
- Sentence-level BLEU is NOT used for publication results

### METEOR

- Library: `nltk.translate.meteor_score.single_meteor_score`
- Includes: WordNet synonym matching, Porter stemming, alignment penalty
- Computed per sentence

### BERTScore

- Library: `bert-score`
- Model: `roberta-base` (switched from default for memory stability on Render)
- `rescale_with_baseline=True`
- Returns F1 score per sentence
- Batch size: 64
- Lazy-loaded: only computed if `compute_bertscore=true` in job config
- Library versions recorded for reproducibility

---

## Client Usage

```typescript
import { submitJob, pollUntilDone } from "@/lib/api";

const { job_id } = await submitJob(csvFile, config);
const results = await pollUntilDone(job_id, onStatus);
// results.corpus_metrics, results.sentence_metrics, etc.
```

No metrics are computed client-side. All values displayed in the UI come from the backend.
