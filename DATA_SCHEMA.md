# Data Schema

This document describes all data structures used in MedTranslate, including TypeScript interfaces, CSV column schemas, and localStorage keys.

---

## TypeScript Interfaces

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

| Field | Type | Description |
|---|---|---|
| `pair_id` | `string` | Unique identifier for the pair (e.g., `"clinspen_doc1_L5"`, `"umass_ehr_L42"`, or auto-generated `"row_N"`) |
| `source` | `"ClinSpEn_ClinicalCases" \| "UMass_EHR"` | Which corpus this pair originates from |
| `content_type` | `"clinical_case_report" \| "ehr_clinical_note"` | The type of clinical document |
| `english_reference` | `string` | Human reference translation (gold standard). May be empty if the dataset only contains source text. |
| `spanish_source` | `string` | Original Spanish clinical text (the input to the LLM) |
| `llm_english_translation` | `string` | LLM-generated English translation. Empty until the translation step is executed. |

### `TranslationResult`

Extends `TranslationPair` with runtime state for the translation workflow. Fields prefixed with `_` are internal application state, not part of the source dataset.

```typescript
interface TranslationResult extends TranslationPair {
  _index: number;
  _status: "pending" | "translating" | "scoring" | "complete" | "error";
  _bleu: number | null;
  _meteor: number | null;
  _bert_proxy: number | null;
  _clinical_grade: ClinicalGrade | null;
  _error_message?: string;
}
```

| Field | Type | Description |
|---|---|---|
| `_index` | `number` | Zero-based row index in the dataset |
| `_status` | `string` | Current processing state of this row |
| `_bleu` | `number \| null` | Client-side BLEU score (null if not yet computed or no reference available) |
| `_meteor` | `number \| null` | Client-side METEOR score |
| `_bert_proxy` | `number \| null` | Client-side BERTProxy score (n-gram cosine similarity, not actual BERTScore) |
| `_clinical_grade` | `ClinicalGrade \| null` | Physician-assigned clinical significance grade (null if not yet graded) |
| `_error_message` | `string \| undefined` | Error message if translation failed |

#### Row Status Lifecycle

```
pending ──> translating ──> scoring ──> complete
                │
                └──> error
```

| Status | Meaning |
|---|---|
| `pending` | Row has not been processed yet |
| `translating` | API request is in flight for this row |
| `scoring` | Translation received; metrics are being computed |
| `complete` | Translation and scoring finished successfully |
| `error` | Translation API call failed; see `_error_message` |

### `ClinicalGrade`

```typescript
type ClinicalGrade = 0 | 1 | 2 | 3;
```

An integer from 0 to 3 representing the physician-assigned clinical significance of a translation discrepancy. See the [Clinical Significance Scale](#clinical-significance-scale) section below.

### `ClinicalGradeInfo`

Metadata for rendering each grade level in the UI.

```typescript
interface ClinicalGradeInfo {
  grade: ClinicalGrade;
  label: string;
  color: string;
  bg: string;
  description: string;
}
```

| Field | Type | Description |
|---|---|---|
| `grade` | `ClinicalGrade` | The numeric grade (0–3) |
| `label` | `string` | Short display label (e.g., `"No error"`, `"Clinically significant"`) |
| `color` | `string` | Hex color for text and accents |
| `bg` | `string` | Hex color for background highlights |
| `description` | `string` | One-line definition of the grade |

The `CLINICAL_GRADES` constant array contains all four grade definitions:

| Grade | Label | Color | Description |
|---|---|---|---|
| 0 | No error | `#10b981` (green) | LLM translation accurately preserves clinical meaning |
| 1 | Minor linguistic | `#f59e0b` (amber) | Stylistic or grammatical difference, no change in clinical meaning |
| 2 | Moderate error | `#f97316` (orange) | Potential for confusion, unlikely to change clinical management |
| 3 | Clinically significant | `#ef4444` (red) | Could alter diagnosis, treatment, or disposition |

### `MetricsSummary`

Aggregate statistics for a set of metric values.

```typescript
interface MetricsSummary {
  count: number;
  bleu: { mean: number; std: number; min: number; max: number };
  meteor: { mean: number; std: number; min: number; max: number };
  bert_proxy: { mean: number; std: number; min: number; max: number };
}
```

### `TranslationConfig`

Configuration for the translation API calls.

```typescript
interface TranslationConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | `"gpt-5.2"` | LLM model identifier |
| `systemPrompt` | `string` | *(medical interpreter prompt)* | System-level instruction for the LLM |
| `temperature` | `number` | `0` | Sampling temperature (0 = deterministic) |
| `maxTokens` | `number` | `1024` | Maximum tokens in the LLM response |

---

## CSV Schemas

### Input Dataset CSV

Produced by `scripts/build_dataset.py` or manually prepared. Minimum required column: `spanish_source`.

| Column | Required | Type | Description |
|---|---|---|---|
| `pair_id` | No | string | Unique row identifier. Auto-generated as `"row_N"` if missing. |
| `source` | No | string | Corpus origin. Defaults to `"ClinSpEn_ClinicalCases"` if missing. |
| `content_type` | No | string | Document type. Defaults to `"clinical_case_report"` if missing. |
| `english_reference` | No | string | Human reference translation. If absent, metrics cannot be computed. |
| `spanish_source` | **Yes** | string | Spanish clinical text to be translated. |
| `llm_english_translation` | No | string | Pre-existing LLM translation (for re-scoring without re-translating). |

### Output / Export CSV

Produced by the "Export CSV" button on the Translate page or by `scripts/translate_batch.py`.

| Column | Type | Description |
|---|---|---|
| `pair_id` | string | Row identifier |
| `source` | string | Corpus origin label |
| `content_type` | string | Document type label |
| `english_reference` | string | Human reference translation |
| `spanish_source` | string | Original Spanish text |
| `llm_english_translation` | string | LLM-generated English translation |
| `bleu_score` | float | BLEU score (4 decimal places) |
| `meteor_score` | float | METEOR score (4 decimal places) |
| `bert_proxy_score` | float | BERTProxy score (4 decimal places) |
| `clinical_significance_grade` | integer | Clinical grade (0–3), empty if not graded |

### Research Metrics CSV

Produced by `scripts/metrics/compute_all.py`. Extends the input CSV with additional columns:

| Column | Type | Description |
|---|---|---|
| `bleu_score` | float | NLTK sentence-level BLEU |
| `meteor_score` | float | NLTK METEOR with WordNet |
| `bert_precision` | float | BERTScore precision |
| `bert_recall` | float | BERTScore recall |
| `bert_f1` | float | BERTScore F1 |

---

## XLSX Support

The upload page accepts `.xlsx` and `.xls` files in addition to `.csv`. XLSX parsing is handled by the `xlsx` library (`lib/csv.ts:parseXLSX()`). The parser:

1. Reads the first sheet of the workbook.
2. Converts rows to objects using the header row as keys.
3. Validates that `spanish_source` column exists.
4. Applies the same defaults as CSV parsing for missing optional fields.

---

## localStorage Schema

Session state is persisted in the browser's `localStorage` via `lib/session.ts`. All values are JSON-serialized.

| Key | Type | Description |
|---|---|---|
| `medtranslate:data` | `TranslationPair[]` | The uploaded and optionally row-limited dataset |
| `medtranslate:prompt` | `string` | The active system prompt |
| `medtranslate:rowLimit` | `number` | The user-selected row limit (if "Custom" mode was chosen) |
| `medtranslate:results` | `TranslationResult[]` | Full translation results including metrics and clinical grades |

### Storage Behavior

- **Write**: Data is written on upload (Upload page) and after each translation/scoring step (Translate page).
- **Read**: Each page reads its needed data on mount via `useEffect`.
- **Clear**: The `clearSessionState()` function removes all four keys. Called when the user clicks "Remove file" on the Upload page.
- **Size limit**: `localStorage` is typically limited to ~5 MB per origin. Large datasets (thousands of rows with full text) may approach this limit.

---

## Source Corpora

### ClinSpEn (Clinical Spanish-English)

- **Origin**: Professionally translated COVID-19 clinical case reports
- **Size**: 3,934 sentence-aligned pairs
- **License**: CC-BY-4.0
- **Source label**: `"ClinSpEn_ClinicalCases"`
- **Content type**: `"clinical_case_report"`
- **File format**: Parallel `.en.txt` / `.es.txt` files, one sentence per line
- **Pair ID format**: `clinspen_{doc_id}_L{line_number}`

### UMass EHR

- **Origin**: De-identified electronic health record clinical notes
- **Size**: 2,942 pairs
- **License**: CC-BY-NC-4.0
- **Source label**: `"UMass_EHR"`
- **Content type**: `"ehr_clinical_note"`
- **File format**: Tab-separated English-Spanish pairs, one pair per line
- **Pair ID format**: `umass_ehr_L{line_number}`
- **Filtering**: Lines shorter than 10 characters and administrative boilerplate (e.g., `"___"`, `"**"`, `"Dictator:"`) are excluded during dataset building.
