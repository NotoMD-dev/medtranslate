# Metrics and Validation

This document describes the automated translation metrics and the clinical validation framework used in MedTranslate. The platform uses a two-tier evaluation approach: automated metrics for scalable scoring and physician adjudication for clinical safety assessment.

---

## Automated Metrics Overview

MedTranslate computes three standard machine translation metrics to quantify how closely an LLM-generated translation matches a human reference translation.

| Metric | What It Measures | Range | Higher = Better |
|---|---|---|---|
| **BLEU** | N-gram precision overlap | 0.0 – 1.0 | Yes |
| **METEOR** | Synonym-aware token matching with word order | 0.0 – 1.0 | Yes |
| **BERTScore** / **BERTProxy** | Semantic similarity via embeddings | 0.0 – 1.0 | Yes |

Each metric exists in two implementations: a fast client-side version for interactive use and a research-grade Python version for publication.

---

## BLEU (Bilingual Evaluation Understudy)

### What It Measures

BLEU computes **modified n-gram precision** between a candidate translation and a reference translation. It counts how many n-grams (contiguous sequences of 1 to 4 words) in the candidate also appear in the reference, then applies a brevity penalty to prevent artificially high scores from overly short translations.

### How It Works (Step by Step)

1. **Tokenize** both candidate and reference by lowercasing, stripping punctuation, and splitting on whitespace.
2. For each n-gram order (n = 1, 2, 3, 4):
   - Extract all n-grams from the candidate.
   - Extract all n-grams from the reference.
   - Count how many candidate n-grams appear in the reference (clipped to reference counts to prevent gaming by repetition).
   - Compute precision = clipped matches / total candidate n-grams.
3. Take the geometric mean of precisions across all n-gram orders (equal weights: 0.25 each).
4. Apply **brevity penalty**: if the candidate is shorter than the reference, multiply by `exp(1 - ref_length / cand_length)`.

### Smoothing

Both implementations use **Method 1 smoothing** to handle zero-count n-grams:

- **Client-side** (`lib/metrics.ts`): When an n-gram order has zero matches, substitutes `epsilon / candidate_ngram_count` (epsilon = 0.1) instead of zero.
- **Python** (`scripts/metrics/compute_all.py`): Uses NLTK's `SmoothingFunction().method1`, which adds a small constant to zero counts.

This ensures sentence-level BLEU does not collapse to zero when any single n-gram order has no matches, which is common for short sentences.

### Strengths and Limitations

| Strengths | Limitations |
|---|---|
| Standard benchmark used across MT research | Penalizes valid rephrasings and synonyms |
| Reproducible and deterministic | Sentence-level scores can be noisy |
| Well-understood interpretation | Does not capture semantic meaning |

---

## METEOR (Metric for Evaluation of Translation with Explicit ORdering)

### What It Measures

METEOR aligns candidate and reference tokens using exact matches (and optionally stems and synonyms), then computes a harmonic mean of precision and recall with a penalty for fragmented word order.

### How It Works (Step by Step)

1. **Tokenize** both candidate and reference.
2. **Align tokens**: Find the best one-to-one mapping between candidate and reference tokens.
   - Client-side: Uses exact token matching only.
   - Python: Uses WordNet synonyms and stemming for richer matching.
3. Compute:
   - **Precision (P)** = matched tokens / candidate tokens
   - **Recall (R)** = matched tokens / reference tokens
   - **F-score** = (10 * P * R) / (9 * P + R) — recall-weighted harmonic mean
4. Compute **fragmentation penalty**:
   - Count the number of contiguous "chunks" of matched tokens in the candidate.
   - Penalty = 0.5 * (chunks / matches)^3
5. Final score = F * (1 - penalty)

### Client vs. Python Differences

| Aspect | Client (`lib/metrics.ts`) | Python (`compute_all.py`) |
|---|---|---|
| Token matching | Exact match only | Exact + stems + WordNet synonyms |
| Fragmentation | Simplified chunk counting via set membership | Full NLTK alignment algorithm |
| Resources | None required | Requires NLTK WordNet data download |

### Strengths and Limitations

| Strengths | Limitations |
|---|---|
| Handles synonyms and morphological variants (Python) | English-centric stemmer and synonym database |
| Considers word order through fragmentation penalty | Client-side version is a simplified approximation |
| Better correlation with human judgments than BLEU | Slower than BLEU for large batches |

---

## BERTScore / BERTProxy

### BERTScore (Python — Research Grade)

BERTScore uses a pretrained transformer model (e.g., RoBERTa) to generate contextual embeddings for each token in the candidate and reference, then computes token-level cosine similarity.

**Outputs three values:**

| Metric | Definition |
|---|---|
| **Precision** | Average maximum cosine similarity from each candidate token to the reference |
| **Recall** | Average maximum cosine similarity from each reference token to the candidate |
| **F1** | Harmonic mean of precision and recall (primary summary metric) |

**Implementation**: Uses the `bert_score` Python package with default English model, computed in batches (default batch size: 64).

### BERTProxy (Client — Approximate)

The browser cannot run transformer models, so MedTranslate uses a lightweight **n-gram cosine similarity** approximation called BERTProxy.

**How it works:**

1. Extract unigrams, bigrams, and trigrams from both candidate and reference.
2. Build frequency vectors over the combined vocabulary.
3. Compute cosine similarity between the two vectors.

**This is NOT BERTScore.** It does not use neural embeddings. It provides a rough estimate of semantic overlap for interactive triage. For any publication or research analysis, use the Python `compute_all.py` pipeline.

### When to Use Which

| Use Case | Implementation | Metric Name |
|---|---|---|
| Interactive triage in the browser | `lib/metrics.ts` | `_bert_proxy` |
| Publication / research analysis | `scripts/metrics/compute_all.py` | `bert_precision`, `bert_recall`, `bert_f1` |

---

## Clinical Significance Scale

Automated metrics cannot reliably detect clinically dangerous translation errors (negation flips, dosage changes, temporal shifts). MedTranslate pairs automated scoring with a **physician-adjudicated clinical significance grading framework**.

### Grade Definitions

| Grade | Label | Color Code | Definition |
|---|---|---|---|
| **0** | No error | Green (`#10b981`) | LLM translation accurately preserves clinical meaning |
| **1** | Minor linguistic error | Amber (`#f59e0b`) | Stylistic or grammatical difference with no change in clinical meaning |
| **2** | Moderate error | Orange (`#f97316`) | Potential for confusion, unlikely to change clinical management |
| **3** | Clinically significant | Red (`#ef4444`) | Could alter diagnosis, treatment, or disposition |

### Review Workflow

1. The **Review page** (`app/review/page.tsx`) filters completed translation pairs to those with **BLEU < 0.4**, which serves as a triage threshold for potentially problematic translations.
2. A physician reviews each flagged pair by comparing:
   - The original Spanish source text
   - The human reference translation (gold standard)
   - The LLM-generated translation
3. The physician assigns a clinical significance grade (0–3) using the `GradeSelector` component.
4. Grade assignments are stored in the `_clinical_grade` field of each `TranslationResult`.

### Grade Distribution Analysis

The **Metrics page** (`app/metrics/page.tsx`) displays:

- Total count and percentage for each grade level
- Visual bar chart of the grade distribution
- Breakdown by data source (ClinSpEn vs. UMass EHR)

---

## Metric Summary Statistics

For each metric, the `summarizeMetric()` function in `lib/metrics.ts` computes:

| Statistic | Formula |
|---|---|
| **Mean** | Sum of values / count |
| **Standard deviation** | Population standard deviation (not sample) |
| **Min** | Minimum value in the set |
| **Max** | Maximum value in the set |

These summaries are displayed on the Metrics dashboard and can be exported via the CSV export.

---

## Interpreting Results Safely

- **High automated scores** (e.g., BLEU > 0.5) generally indicate good lexical agreement with the reference, but do **not** guarantee clinical safety.
- **Low automated scores** may indicate genuine translation errors or simply valid rephrasings that differ from the reference wording.
- Clinical translation risk often comes from **small but critical errors** (negation, dosage, temporality) that n-gram and even embedding-based metrics can miss.
- The clinical significance grading framework exists precisely to catch what automated metrics cannot.

---

## Running the Research-Grade Metrics Pipeline

```bash
cd scripts/metrics
pip install -r requirements.txt

python compute_all.py \
  --input ../../data/results_with_translations.csv \
  --output ../../data/results_with_metrics.csv \
  --batch-size 64
```

### Requirements

| Package | Version | Purpose |
|---|---|---|
| `nltk` | >= 3.8 | Tokenization, BLEU, METEOR, WordNet |
| `bert-score` | >= 0.3.13 | BERTScore computation |
| `torch` | >= 2.0 | PyTorch backend for BERTScore |
| `pandas` | >= 2.0 | CSV processing and data manipulation |

### Output Columns Added

| Column | Type | Description |
|---|---|---|
| `bleu_score` | `float` | NLTK sentence-level BLEU with Method 1 smoothing |
| `meteor_score` | `float` | NLTK METEOR with WordNet synonyms |
| `bert_precision` | `float` | BERTScore precision |
| `bert_recall` | `float` | BERTScore recall |
| `bert_f1` | `float` | BERTScore F1 (harmonic mean of P and R) |

### Summary Output

The script prints aggregate statistics to stdout after completion:

```
=== SUMMARY ===
Total rows: 6876
Scored rows: 6800
BLEU   mean: 0.4523  std: 0.2145
METEOR mean: 0.5678  std: 0.1876
BERT F1 mean: 0.8934  std: 0.0567

--- By Source ---
ClinSpEn_ClinicalCases (n=3934):
  BLEU:    0.4712 +/- 0.2034
  METEOR:  0.5823 +/- 0.1745
  BERT F1: 0.8978 +/- 0.0534

UMass_EHR (n=2866):
  BLEU:    0.4267 +/- 0.2278
  METEOR:  0.5489 +/- 0.2012
  BERT F1: 0.8873 +/- 0.0608
```
