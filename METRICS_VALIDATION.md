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

---

## Corpus BLEU (sacrebleu)

### Implementation

- **Library**: `sacrebleu` (default 13a tokenization)
- **Function**: `sacrebleu.corpus_bleu(hypotheses, [references])`
- **Source**: `medtranslate-backend/app/metrics.py:compute_corpus_bleu()`

### What Is Returned

- `bleu_score`: The corpus-level BLEU score
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

| Parameter | Value |
|---|---|
| `lang` | `"en"` |
| `rescale_with_baseline` | `True` (required for publication) |
| `batch_size` | 64 |

### What Is Recorded

- BERTScore F1 per sentence
- `bert-score` library version
- `torch` library version
- Model used (recorded via library defaults)

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

### Review Workflow

1. The **Review page** filters completed translation pairs to those with **METEOR < 0.4**, which serves as a triage threshold for potentially problematic translations.
2. A physician reviews each flagged pair by comparing the Spanish source, human reference, and LLM translation.
3. The physician assigns a clinical significance grade (0–3).
4. Grade assignments are stored client-side and can be exported with the results CSV.

---

## Interpreting Results Safely

- **High automated scores** generally indicate good lexical/semantic agreement with the reference, but do **not** guarantee clinical safety.
- **Low automated scores** may indicate genuine translation errors or valid rephrasings that differ from the reference wording.
- Clinical translation risk often comes from **small but critical errors** (negation, dosage, temporality) that metrics can miss.
- The clinical significance grading framework exists precisely to catch what automated metrics cannot.
