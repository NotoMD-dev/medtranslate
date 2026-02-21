# API Specification

This document describes the HTTP API exposed by the MedTranslate backend (FastAPI). The backend handles all translation and metric computation. The frontend submits jobs, polls status, and fetches results.

## Base URLs

```
http://localhost:8000       (local development)
https://your-app.onrender.com  (production — Render)
```

---

## `POST /v1/jobs`

Submit a CSV file and model configuration to start a translation + metrics job.

**Source file**: `medtranslate-backend/app/main.py`

### Request

**Content-Type**: `multipart/form-data`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | file (CSV) | Yes | — | CSV file with at least a `spanish_source` column |
| `model` | string | No | `"gpt-4o"` | OpenAI model identifier |
| `system_prompt` | string | No | *(medical interpreter prompt)* | System prompt for the LLM |
| `temperature` | float | No | `0.0` | Sampling temperature |
| `max_tokens` | int | No | `1024` | Maximum tokens in the LLM response |

**Required CSV columns**: `spanish_source`

**Optional CSV columns**: `pair_id`, `source`, `content_type`, `english_reference`, `llm_english_translation`

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
  "total": 1000,
  "translated": 450,
  "scored": 320,
  "failed_rows": 2,
  "error": null
}
```

| Field | Type | Description |
|---|---|---|
| `job_id` | string | The job identifier |
| `status` | string | One of: `queued`, `running`, `complete`, `failed` |
| `total` | int | Total rows in the dataset |
| `translated` | int | Rows translated so far |
| `scored` | int | Rows with metrics computed so far |
| `failed_rows` | int | Rows that failed translation |
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
  "model_config": {
    "model": "gpt-4o",
    "system_prompt": "You are a medical interpreter...",
    "temperature": 0.0,
    "max_tokens": 1024
  }
}
```

### Key Fields

| Field | Description |
|---|---|
| `corpus_metrics.overall` | Corpus-level BLEU for the entire dataset (sacrebleu) |
| `corpus_metrics.clinspen` | Corpus BLEU for ClinSpEn rows only |
| `corpus_metrics.umass` | Corpus BLEU for UMass rows only |
| `sentence_metrics[].meteor` | Per-sentence METEOR (NLTK, with WordNet + stemming) |
| `sentence_metrics[].bertscore_f1` | Per-sentence BERTScore F1 (rescaled with baseline) |
| `library_versions` | Exact library versions for reproducibility reporting |

---

## Environment Variables

### Backend

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key for translations |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (defaults to localhost:3000) |
| `DEFAULT_MODEL` | No | Default model name (defaults to `gpt-4o`) |

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
- `rescale_with_baseline=True`
- Returns F1 score per sentence
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
