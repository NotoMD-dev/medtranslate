# Data Schema

This document describes all data structures used in MedTranslate, including TypeScript interfaces, backend Pydantic models, CSV column schemas, and client-side storage schemas.

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

### `ModelConfig`

Translation configuration used for a job.

```typescript
interface ModelConfig {
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
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
  translation_config: ModelConfig | null;
}
```

### `JobStatus`

```typescript
type JobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";
```

### `JobStatusResponse`

Status polling response.

```typescript
interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
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

### `CLINICAL_GRADES`

Array defining grade metadata (label, color, description). Used by `GradeSelector`, `GradeRow`, and the Review/Metrics pages.

```typescript
const CLINICAL_GRADES = [
  { grade: 0, label: "No error",               color: "#10b981", description: "..." },
  { grade: 1, label: "Minor linguistic error",  color: "#f59e0b", description: "..." },
  { grade: 2, label: "Moderate error",          color: "#f97316", description: "..." },
  { grade: 3, label: "Clinically significant",  color: "#ef4444", description: "..." },
];
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

### Input XLSX

Same column schema as CSV. XLSX files are uploaded to the backend, which parses them server-side using `openpyxl` and converts to the internal row format. The frontend does not parse XLSX files.

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

## Client-Side Storage

### localStorage Schema

Session state is persisted in the browser's `localStorage` via `lib/session.ts`.

| Key | Type | Description |
|---|---|---|
| `medtranslate:data` | `TranslationPair[]` | The uploaded and optionally row-limited dataset |
| `medtranslate:prompt` | `string` | The active system prompt |
| `medtranslate:rowLimit` | `number` | The user-selected row limit |
| `medtranslate:jobId` | `string` | The current backend job ID |
| `medtranslate:csvFile` | `string` | Original uploaded file name (display only) |
| `medtranslate:grades` | `Record<string, ClinicalGrade>` | Physician-assigned clinical grades by pair_id |

### IndexedDB Schema

Large data is stored in IndexedDB via `lib/idb.ts` to avoid localStorage's ~5 MB quota limit.

| Database | Version | Object Store | Description |
|---|---|---|---|
| `medtranslate` | 1 | `session` | Key-value store for large objects |

| Key (within `session` store) | Type | Description |
|---|---|---|
| `jobResults` | `JobResults` | Full backend results (corpus + sentence metrics) |
| `grades` | `Record<string, ClinicalGrade>` | Redundant copy of grades for safety |

**Functions** (exported from `lib/idb.ts`):
- `getJobResultsIDB()` → `Promise<JobResults | null>`
- `setJobResultsIDB(results: JobResults | null)` → `Promise<void>`
- `getGradesIDB()` → `Promise<Record<string, ClinicalGrade> | null>`
- `setGradesIDB(grades: Record<string, ClinicalGrade> | null)` → `Promise<void>`

### Theme Storage

| Key | Value | Location |
|---|---|---|
| `medtranslate-theme` | `"light"` \| `"dark"` | localStorage |

Managed by `ThemeProvider` in `src/design-system/primitives/ThemeProvider.tsx`.
