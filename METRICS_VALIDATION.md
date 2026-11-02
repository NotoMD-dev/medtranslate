# Metrics and Validation

This document describes the automated translation metrics and the clinical validation framework used in MedTranslate. All metrics are computed server-side in the Python backend using reference implementations. No metrics are computed in the browser.

---

## Automated Metrics Overview

MedTranslate computes three standard machine translation metrics to quantify how closely an LLM-generated translation matches a human reference translation.

| Metric | What It Measures | Range | Higher = Better | Library |
|---|---|---|---|---|
| **Corpus BLEU** | N-gram precision overlap (corpus level) | 0.0 – 100.0 | Yes | sacrebleu |
| **METEOR** | Synonym-aware token matching with word order | 0.0 – 1.0 | Yes | NLTK |
| **BERTScore F1** | Semantic similarity via contextual embeddings | 0.0 – 1.0 | Yes | bert-score |

All metrics are computed in the FastAPI backend (`medtranslate-backend/app/metrics.py`). The frontend displays values exactly as returned by the backend JSON.

A plain-language explanation of the three metrics, written for readers without a machine-translation background, is available in the app behind the "What do these scores mean?" link on the Metrics and Compare pages and on the About page (`components/MetricGuide.tsx`). This document is the technical reference.

### Which rows are scored

A row needs a non-empty `english_reference` to be scored at all. Beyond that, scoring depends on how the translation ended:

| Outcome | `error_kind` | METEOR | BERTScore | Corpus BLEU | Review queue |
|---|---|---|---|---|---|
| Completed | `null` | computed | computed if enabled | hypothesis = reply | if METEOR < threshold |
| Refused (model declined / empty reply) | `"refusal"` | `0.0` | `0.0` if enabled | hypothesis = `""` | always, first |
| Incomplete (provider / config failure) | `"infrastructure"` | `null` | `null` | excluded | never; retry instead |
| Excluded (reviewer judged the refusal legitimate) | `"excluded"` | `null` | `null` | excluded | stays visible so the decision can be undone |

Scoring refusals as zero is a deliberate study decision: a model that declines a clinical sentence has failed to translate it, and the failure must show in the averages. The reviewer override exists for the opposite case: when the physician judges that the source line was not translatable or not clinical (an administrative fragment, a corrupted line), the refusal is excluded from every score rather than counted against the model. The decision is keyed by `pair_id`, so it applies identically to every model that saw that sentence, and the reason is exported with the review CSV. Infrastructure failures say nothing about the model and are excluded; the `incomplete_rows` count in the job status and the "Incomplete" row on the Compare page show how many rows are missing from the averages. An empty candidate is given BERTScore 0 directly rather than embedded; with rescaling, 0 is the "unrelated sentences" baseline.

### How translations are produced

- Each unique source text in a job is translated once and the result is fanned out to duplicate rows.
- The backend keeps a SQLite translation cache keyed on `(model, system_prompt, temperature, reasoning_effort, source_text)`. A re-run with identical settings returns cached text without calling the provider, so identical output across re-runs is not evidence of model determinism.
- METEOR and BERTScore values are cached per `(candidate, reference)` pair in SQLite (`metric_cache`). Re-scores reuse them; only rows that changed are recomputed. The METEOR key includes the NLTK version; the BERTScore key includes the model and rescaling configuration.
- The reasoning/thinking effort applied (`OPENAI_REASONING_EFFORT` or `ANTHROPIC_EFFORT`, default `medium` for both) is recorded as `translation_config.reasoning_effort` in the results.
- Temperature is **not** sent to GPT-5.x reasoning models or Claude 4.6+ models; both families reject the parameter. `translation_config.temperature` records what was actually sent: `0.0` for older OpenAI chat models, `null` for the current models. Runs with `null` are not guaranteed to be deterministic; identical text across re-runs comes from the cache, not the model.
- The system prompt ends with "Output only the English translation, with no preamble, notes, quotation marks, or explanations." Replies are still scored exactly as returned. A reply that nonetheless adds a preamble or note lowers BLEU sharply (precision-based) while lowering METEOR only modestly (recall-weighted); `format_warning` flags such replies so a BLEU gap can be traced to formatting before it is attributed to translation quality. Runs made before this sentence was added are not comparable with later runs; the Compare page warns when two runs used different prompts.

---

## Corpus BLEU (sacrebleu)

### Implementation

- **Library**: `sacrebleu` (default 13a tokenization)
- **Function**: `sacrebleu.corpus_bleu(hypotheses, [references])`
- **Source**: `medtranslate-backend/app/metrics.py:compute_corpus_bleu()`

### What Is Returned

- `bleu_score`: The corpus-level BLEU score (0.0–100.0)
- `bleu_signature`: Full signature string including n-gram precisions, brevity penalty, and lengths

### Computation Scope

Corpus BLEU is computed at three levels:
1. **Overall**: All translated rows with references
2. **ClinSpEn-only**: Rows where `source == "ClinSpEn_ClinicalCases"`
3. **UMass-only**: Rows where `source == "UMass_EHR"`

### Important

Sentence-level BLEU is NOT used for publication results. Corpus BLEU provides a more stable and meaningful aggregate measure.

---

## METEOR (NLTK — Full Implementation)

### Implementation

- **Library**: `nltk.translate.meteor_score.single_meteor_score`
- **Source**: `medtranslate-backend/app/metrics.py:compute_meteor()`

### What It Includes

- **Exact token matching**
- **Porter stemming** (morphological variants)
- **WordNet synonym matching** (semantic equivalents)
- **Alignment penalty** (fragmentation-based word order penalty)

### NLTK Data Requirements

The following NLTK data packages are downloaded during Docker build:
- `wordnet` (for synonym matching)
- `omw-1.4` (Open Multilingual WordNet)
- `punkt` (tokenizer)
- `punkt_tab` (tokenizer data)

### Important

Approximate or simplified JavaScript versions of METEOR are NOT acceptable for publication. The backend uses the full NLTK implementation with all matching stages.

---

## BERTScore (HuggingFace bert-score)

### Implementation

- **Library**: `bert-score`
- **Function**: `bert_score.score()` with `rescale_with_baseline=True`
- **Source**: `medtranslate-backend/app/metrics.py:compute_bertscore_batch()`

### Configuration

| Parameter | Value | Notes |
|---|---|---|
| `lang` | `"en"` | English language |
| `model_type` | `roberta-base` | Switched from default for Render memory stability |
| `rescale_with_baseline` | `True` | Required for publication |
| `batch_size` | 64 | Configurable for memory management |

### What Is Recorded

- BERTScore F1 per sentence
- `bert-score` library version
- `torch` library version
- Model used (recorded via library defaults)

### Lazy Loading

BERTScore computation requires ~400MB of PyTorch model weights. It is only loaded and computed when `compute_bertscore=true` is passed in the job configuration. This prevents unnecessary memory usage on resource-constrained servers.

---

## Library Version Reporting (Reproducibility)

The backend records and returns exact library versions with every job result:

```json
{
  "library_versions": {
    "sacrebleu": "2.4.3",
    "nltk": "3.9.1",
    "bert_score": "0.3.13",
    "torch": "2.5.1"
  }
}
```

These versions are displayed in the Metrics dashboard and should be cited in any publication using these results.

---

## Clinical Significance Scale

Automated metrics cannot reliably detect clinically dangerous translation errors. MedTranslate pairs automated scoring with physician-adjudicated clinical significance grading.

### Grade Definitions

| Grade | Label | Color Code | Definition |
|---|---|---|---|
| **0** | No error | Green (`#10b981`) | LLM translation accurately preserves clinical meaning |
| **1** | Minor linguistic error | Amber (`#f59e0b`) | Stylistic or grammatical difference with no change in clinical meaning |
| **2** | Moderate error | Orange (`#f97316`) | Potential for confusion, unlikely to change clinical management |
| **3** | Clinically significant | Red (`#ef4444`) | Could alter diagnosis, treatment, or disposition |

### What Triggers Clinician Review

A pair enters the review queue when **all** of the following hold:

| Condition | Where it is enforced |
|---|---|
| The row is completed (translation, no `error`) **or** refused (`error_kind == "refusal"`) | `app/review/page.tsx` via `isCompleted` / `isRefused` in `lib/metrics.ts` |
| The row has a METEOR score (requires an `english_reference`; refusals are scored 0) | backend scoring; `meteor != null` |
| METEOR is **strictly below** the threshold | Review page threshold box, default `0.4`, saved to the session |

Refused rows are listed first with a "Refused" badge and the provider's reason. Incomplete rows (infrastructure failures) never enter the queue; they are retried from the Translate page. Nothing else triggers review. BLEU is corpus-level and cannot flag a sentence; BERTScore is optional and is not consulted. The threshold is shared with the Metrics page's "Flagged for Review" count. The threshold is a triage heuristic: it concentrates physician time on the sentences most likely to differ from the reference, but a pair above the threshold can still contain a clinically significant error (a dropped negation moves METEOR very little). Reviewers may also use the "jump to pair" box to grade any flagged pair and the reference-flag control to mark a weak reference.

### Head-to-Head Reviewer Verdicts

The Compare page lets a reviewer open any sentence among the largest METEOR differences, read both models' raw outputs next to the source and reference, and record which output is actually better (or that they are about equal), with a note. This is a human preference judgment, independent of the automated metrics and of the clinical significance grade: it answers "which model translated this sentence better?" rather than "is this translation safe?". Verdicts are keyed by `pair_id`, store the model pair they were made on, and are exported with both outputs and scores (`medtranslate_head_to_head.csv`). Reported alongside the metrics, the tally of verdicts on the largest-gap sentences shows whether score gaps correspond to real quality differences or to wording and formatting.

### Review Workflow

1. The **Review page** filters completed translation pairs to those with **METEOR < threshold** (default 0.4, configurable), which serves as a triage threshold for potentially problematic translations.
2. A physician reviews each flagged pair by comparing the Spanish source, human reference, and LLM translation in a three-column detail panel.
3. The physician assigns a clinical significance grade (0–3) using the `GradeSelector` component.
4. Grade assignments are stored client-side (localStorage + IndexedDB) and can be exported with the results CSV.
5. Grade distribution is visualized in real-time on both the Review and Metrics pages.

---

## Metrics Display

### Metrics Dashboard (`/metrics`)

The Metrics page displays:

- **Corpus BLEU**: Overall + per-dataset (ClinSpEn, UMass) with signature strings
- **METEOR statistics**: Mean, standard deviation, min, max across all sentences
- **BERTScore F1 statistics**: Mean, standard deviation, min, max (if computed)
- **Clinical grade distribution**: Bar chart showing count per grade level
- **Flagged pair count**: Number of pairs below the METEOR threshold
- **Library versions**: Exact versions of sacrebleu, NLTK, bert-score, and torch

### Per-Row Display (`/translate`, `/review`)

Each row in the results table shows:
- METEOR score (4 decimal places)
- BERTScore F1 (4 decimal places, if computed)
- Status badge (pending, translating, scoring, complete, error)

The PairDetail modal shows the full three-column text comparison alongside per-sentence metrics and the grade selector.

---

## Interpreting Results Safely

- **High automated scores** generally indicate good lexical/semantic agreement with the reference, but do **not** guarantee clinical safety.
- **Low automated scores** may indicate genuine translation errors or valid rephrasings that differ from the reference wording.
- Clinical translation risk often comes from **small but critical errors** (negation, dosage, temporality) that metrics can miss.
- The clinical significance grading framework exists precisely to catch what automated metrics cannot.
