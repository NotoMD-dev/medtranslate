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
  /** Exact error message if the row failed. */
  error: string | null;
  /** "refusal" (scored 0) | "infrastructure" (unscored, retryable) | "excluded" (reviewer override, unscored) | null */
  error_kind?: "refusal" | "infrastructure" | "excluded" | null;
  /** Heuristic note when the reply looks wrapped; the text is never modified. */
  format_warning?: string | null;
}
```

Row classification helpers live in `lib/metrics.ts`: `isCompleted`, `isRefused`, `isIncomplete`, `isScored` (completed or refused with a METEOR value), `countRun`, and `failureReasons`.

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
  /** Temperature actually sent to the provider, or null if the model rejects it (not sent). */
  temperature: number | null;
  max_tokens: number;
  /** Reasoning/thinking effort the backend applied, or null if the model takes none. */
  reasoning_effort?: string | null;
}
```

`temperature` is `0.0` only for models that accept the parameter (older OpenAI chat models). GPT-5.x reasoning models and current Claude models reject it, so for them the backend sends nothing and records `null`; those runs are not guaranteed to be deterministic.

`reasoning_effort` is set by the backend at job creation from `OPENAI_REASONING_EFFORT` (GPT-5.x reasoning models) or `ANTHROPIC_EFFORT` (Claude 4.6+). It is part of the translation-cache key and is displayed on the Compare page.

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
  phase?: string;             // queued | translating | meteor | bleu | bertscore | complete | failed | cancelled
  total: number;
  translated: number;
  scored: number;
  failed_rows: number;        // refused_rows + incomplete_rows
  refused_rows?: number;      // model declined / empty reply (scored 0)
  incomplete_rows?: number;   // provider / config failure (unscored)
  excluded_rows?: number;     // reviewer-overridden refusals (unscored)
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
| `ModelConfig` | Translation configuration (model, prompt, temp, max_tokens, compute_bertscore, metrics_only, reasoning_effort) |

---

## CSV Schemas

### Input Dataset CSV

Produced by `scripts/build_dataset.py`, manually prepared, or one of the bundled demo files in `public/demo/` (`medtranslate_demo_spanish.csv`, `medtranslate_demo_french.csv`; 15 synthetic rows each, `source = "Demo_Synthetic"`).

| Column | Required | Type | Description |
|---|---|---|---|
| `<language>_source` | **Yes** | string | Source clinical text. The column name follows the selected source language: `spanish_source`, `french_source`, `korean_source`, `chinese_source`, `portuguese_source`, `german_source`, `arabic_source`, `japanese_source`, `russian_source`. A generic `source_text` column is also accepted. |
| `pair_id` | No | string | Unique row identifier (auto-generated if missing) |
| `source` | No | string | Corpus origin (defaults to `"ClinSpEn_ClinicalCases"`) |
| `content_type` | No | string | Document type (defaults to `"clinical_case_report"`) |
| `english_reference` | No | string | Human reference translation (required for metrics) |
| `llm_english_translation` | No | string | Pre-existing translation (for re-scoring) |
| `error` | No | string | Carried over on metrics-only re-scores so a failed row keeps its status |
| `error_kind` | No | string | `refusal`, `infrastructure`, or `excluded`, paired with `error` |

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
| `reference_flag_issues` | string | Reviewer's reference-quality flags, `;`-separated |
| `reference_flag_notes` | string | Reviewer's free-text note on the reference |
| `status` | string | `completed`, `refused`, `incomplete`, or `pending` |
| `error` | string | Exact error message if translation failed |
| `format_warning` | string | Wrapper-text heuristic note, if any |

---

## Client-Side Storage

### localStorage Schema

`medtranslate:reviewThreshold` (number, 0–1) stores the METEOR review threshold set on the Review page; the Metrics page reads it for its "Flagged for Review" count. Absent means the default `0.4`.

`medtranslate:refusalOverrides` (`Record<pair_id, { note: string; at: string }>`) stores reviewer decisions that a refusal was legitimate. Every page applies it with `applyRefusalOverrides()` before computing counts and averages; the Translate page's "Apply reviewer overrides & re-score" sends the rows with `error_kind=excluded` so the backend's corpus BLEU drops them too.

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
