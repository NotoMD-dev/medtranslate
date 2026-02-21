# Data Schema

This document describes all data structures used in MedTranslate, including TypeScript interfaces, backend Pydantic models, CSV column schemas, and localStorage keys.

---

## TypeScript Interfaces (Frontend)

All TypeScript types are defined in `lib/types.ts`.

### `TranslationPair`

The base data structure representing a single aligned Spanish-English text pair from the uploaded dataset.

```typescript
interface TranslationPair {
  pair_id: string;
  source: "ClinSpEn_ClinicalCases" | "UMass_EHR";
  content_type: "clinical_case_report" | "ehr_clinical_note";
  english_reference: string;
  spanish_source: string;
  llm_english_translation: string;
}
```

### `SentenceMetrics`

Per-sentence results returned by the backend. Contains the translation text, metric scores, and any errors.

```typescript
interface SentenceMetrics {
  pair_id: string;
  source: string;
  content_type: string;
  spanish_source: string;
  english_reference: string;
  llm_english_translation: string;
  meteor: number | null;
  bertscore_f1: number | null;
  error: string | null;
}
```

### `CorpusMetrics`

Corpus-level BLEU computed via sacrebleu.

```typescript
interface CorpusMetrics {
  bleu_score: number;
  bleu_signature: string;
}
```

### `DatasetCorpusMetrics`

Corpus BLEU broken down by dataset.

```typescript
interface DatasetCorpusMetrics {
  overall: CorpusMetrics;
  clinspen: CorpusMetrics | null;
  umass: CorpusMetrics | null;
}
```

### `LibraryVersions`

Library versions for reproducibility.

```typescript
interface LibraryVersions {
  sacrebleu: string;
  nltk: string;
  bert_score: string;
  torch: string;
}
```

### `JobResults`

Complete results from a backend job.

```typescript
interface JobResults {
  job_id: string;
  status: JobStatus;
  corpus_metrics: DatasetCorpusMetrics | null;
  sentence_metrics: SentenceMetrics[];
  library_versions: LibraryVersions | null;
  model_config: ModelConfig | null;
}
```

### `JobStatusResponse`

Status polling response.

```typescript
interface JobStatusResponse {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  total: number;
  translated: number;
  scored: number;
  failed_rows: number;
  error: string | null;
}
```

### `ClinicalGrade`

```typescript
type ClinicalGrade = 0 | 1 | 2 | 3;
```

---

## Backend Pydantic Models

Defined in `medtranslate-backend/app/schemas.py`. These mirror the TypeScript interfaces above and define the API contract.

### Key Models

| Model | Purpose |
|---|---|
| `JobCreated` | Response from POST /v1/jobs |
| `JobStatusResponse` | Response from GET /v1/jobs/{id} |
| `SentenceMetrics` | Per-sentence results |
| `CorpusMetrics` | Corpus-level BLEU score + signature |
| `DatasetCorpusMetrics` | Overall + per-dataset corpus BLEU |
| `LibraryVersions` | Version strings for reproducibility |
| `JobResults` | Complete response from GET /v1/jobs/{id}/results |
| `ModelConfig` | Translation configuration (model, prompt, temp, max_tokens) |

---

## CSV Schemas

### Input Dataset CSV

Produced by `scripts/build_dataset.py` or manually prepared.

| Column | Required | Type | Description |
|---|---|---|---|
| `spanish_source` | **Yes** | string | Spanish clinical text to be translated |
| `pair_id` | No | string | Unique row identifier (auto-generated if missing) |
| `source` | No | string | Corpus origin (defaults to `"ClinSpEn_ClinicalCases"`) |
| `content_type` | No | string | Document type (defaults to `"clinical_case_report"`) |
| `english_reference` | No | string | Human reference translation (required for metrics) |
| `llm_english_translation` | No | string | Pre-existing translation (for re-scoring) |

### Output / Export CSV

Exported from the frontend after a job completes.

| Column | Type | Description |
|---|---|---|
| `pair_id` | string | Row identifier |
| `source` | string | Corpus origin label |
| `content_type` | string | Document type label |
| `english_reference` | string | Human reference translation |
| `spanish_source` | string | Original Spanish text |
| `llm_english_translation` | string | LLM-generated English translation |
| `meteor_score` | float | METEOR score (4 decimal places) |
| `bertscore_f1` | float | BERTScore F1 (4 decimal places) |
| `clinical_significance_grade` | integer | Clinical grade (0–3), empty if not graded |
| `error` | string | Error message if translation failed |

---

## localStorage Schema

Session state is persisted in the browser's `localStorage` via `lib/session.ts`.

| Key | Type | Description |
|---|---|---|
| `medtranslate:data` | `TranslationPair[]` | The uploaded and optionally row-limited dataset |
| `medtranslate:prompt` | `string` | The active system prompt |
| `medtranslate:rowLimit` | `number` | The user-selected row limit |
| `medtranslate:jobId` | `string` | The current backend job ID |
| `medtranslate:jobResults` | `JobResults` | Full backend results (corpus + sentence metrics) |
| `medtranslate:grades` | `Record<string, ClinicalGrade>` | Physician-assigned clinical grades by pair_id |
| `medtranslate:csvFile` | `string` | Original uploaded file name (display only) |
