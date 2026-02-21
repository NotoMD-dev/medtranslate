# MedTranslate

**A clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.**

MedTranslate is the research instrument and technical proof-of-concept for a study evaluating whether large language models can produce clinically accurate and safe English translations of Spanish medical text. It combines batch LLM translation, automated translation metrics (BLEU, METEOR, BERTScore), and a physician-adjudicated clinical significance grading framework.

## Study Context

This tool supports a corpus-based evaluation study using 6,876 sentence-aligned Spanish-English medical text pairs from two sources:

- **ClinSpEn Corpus** (3,934 pairs): Professionally translated COVID-19 clinical case reports ([Zenodo](https://zenodo.org/records/7711516), CC-BY-4.0)
- **UMass EHR Pairs** (2,942 pairs): De-identified electronic health record clinical notes ([GitHub](https://github.com/shahidul034/NoteAid-translation-EngToSpa), CC-BY-NC-4.0)

The study evaluates LLM translations in the Spanish-to-English direction, which reflects the real clinical interpreter use case: a patient speaks Spanish, and the clinician needs to understand in English.

## Architecture

```
medtranslate/
├── app/                    # Next.js app router pages
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Landing/upload page
│   ├── translate/
│   │   └── page.tsx        # Batch translation interface
│   ├── review/
│   │   └── page.tsx        # Clinical safety grading interface
│   └── api/
│       └── translate/
│           └── route.ts    # Translation API endpoint
├── components/             # Shared React components
│   ├── Header.tsx
│   ├── MetricsCard.tsx
│   ├── PairDetail.tsx
│   ├── GradeSelector.tsx
│   └── StatusPill.tsx
├── lib/                    # Utilities and shared logic
│   ├── metrics.ts          # Client-side BLEU/METEOR computation
│   ├── csv.ts              # CSV parse/export utilities
│   └── types.ts            # TypeScript type definitions
├── scripts/                # Python backend scripts
│   ├── build_dataset.py    # Unified corpus builder
│   ├── metrics/
│   │   ├── compute_all.py  # Batch BLEU/METEOR/BERTScore
│   │   └── requirements.txt
│   └── translate_batch.py  # Standalone batch translation script
├── data/                   # Dataset directory (gitignored, see setup)
│   └── .gitkeep
├── .env.example            # Environment variable template
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```

## How the Application Works (End-to-End)

MedTranslate follows a linear research workflow. Each stage writes data needed by the next stage.

1. **Dataset preparation (offline Python script)**
   - `scripts/build_dataset.py` combines ClinSpEn and UMass rows into one normalized CSV.
   - Output includes the core aligned columns (`spanish_source`, `english_reference`, `source`) used throughout the app.

2. **Upload and configuration (web UI)**
   - In `app/page.tsx`, researchers upload the prepared CSV, select a model/provider, and configure a system prompt.
   - Parsed rows are stored client-side and passed to downstream pages.

3. **Batch translation (web UI + API route)**
   - `app/translate/page.tsx` iterates through uploaded Spanish text and sends requests to `app/api/translate/route.ts`.
   - The API route calls the selected LLM provider and returns English translations.
   - The UI tracks progress and row-level statuses (success/error), producing a result table suitable for export.

4. **Automated scoring (browser + optional Python backend)**
   - Browser-side: `lib/metrics.ts` computes quick BLEU/METEOR/BERT-proxy estimates for immediate triage.
   - Research-grade: `scripts/metrics/compute_all.py` computes BLEU, METEOR, and BERTScore (P/R/F1) using standard NLP libraries.

5. **Clinical review and adjudication (web UI)**
   - `app/review/page.tsx` prioritizes potentially risky translations (typically low metric scores).
   - Physicians assign severity using the 0–3 Clinical Significance Scale.

6. **Aggregate analysis dashboard (web UI)**
   - `app/metrics/page.tsx` summarizes score distributions, means/variance, grade counts, and source-level comparisons.

## Codebase Guide (What Lives Where)

### `app/` — Route-level features
- `app/page.tsx`: Project entry point; upload/configuration screen.
- `app/translate/page.tsx`: Batch execution and status monitoring.
- `app/review/page.tsx`: Human safety review workflow.
- `app/metrics/page.tsx`: Aggregated metrics and study summary view.
- `app/api/translate/route.ts`: Server endpoint that brokers translation requests to LLM providers.

### `components/` — Reusable UI building blocks
- `Header.tsx`: Shared top navigation and workflow tabs.
- `MetricsCard.tsx`: Standard metric value display card.
- `PairDetail.tsx`: Side-by-side source/reference/translation detail panel.
- `GradeSelector.tsx`: Clinical significance grade control.
- `StatusPill.tsx`: Compact status badges (e.g., translated, error, pending).

### `lib/` — Shared non-UI logic
- `types.ts`: Canonical TypeScript data models for rows, grades, and computed results.
- `csv.ts`: CSV parsing and export helpers used by upload and download paths.
- `metrics.ts`: Fast, client-safe metric implementations and summary helpers.

### `scripts/` — Reproducible offline pipelines
- `build_dataset.py`: Combines and normalizes source corpora into one study-ready CSV.
- `translate_batch.py`: Non-UI batch translation runner for scripted experiments.
- `metrics/compute_all.py`: Publication-oriented metric pipeline using NLTK + `bert_score`.

## Data Model and Core CSV Columns

The workflow assumes (at minimum) these fields:

- `spanish_source`: Original Spanish sentence/note fragment.
- `english_reference`: Human reference translation (gold standard).
- `llm_english_translation`: Model-generated translation (added during translation stage).
- `source`: Dataset origin label (`clinspen` or `umass`) for stratified analysis.

Downstream scripts/pages may also add:

- `bleu_score`, `meteor_score`
- `bert_precision`, `bert_recall`, `bert_f1`
- `clinical_grade` (0–3 physician adjudication)

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- An OpenAI API key (for GPT translations) and/or Anthropic API key (for Claude translations)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/medtranslate.git
cd medtranslate
npm install
```

### 2. Set up environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your API keys:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Prepare the dataset

Download the source corpora and build the unified dataset:

```bash
# Download ClinSpEn corpus from Zenodo
wget https://zenodo.org/records/7711516/files/clinspen_corpora_complete.zip
unzip clinspen_corpora_complete.zip -d data/clinspen

# Download UMass EHR pairs
wget -O data/umass_ehr_pairs.txt \
  https://raw.githubusercontent.com/shahidul034/NoteAid-translation-EngToSpa/main/umass_ehr_pairs.txt

# Build unified dataset
python scripts/build_dataset.py \
  --clinspen data/clinspen/clinspen_corpora_complete/clinspen_clinicalcases \
  --umass data/umass_ehr_pairs.txt \
  --output data/unified_translation_dataset.csv
```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload `data/unified_translation_dataset.csv`.

### 5. (Optional) Compute research-grade metrics

The web interface computes approximate metrics in the browser. For publication-quality BERTScore, use the Python pipeline:

```bash
cd scripts/metrics
pip install -r requirements.txt
python compute_all.py \
  --input ../../data/results_with_translations.csv \
  --output ../../data/results_with_metrics.csv
```

## Web Interface

The app provides four workflow stages:

| Tab | Purpose |
|---|---|
| **Upload** | Load CSV dataset, configure LLM model and system prompt |
| **Translate** | Run batch translations with live progress, per-row status tracking |
| **Review** | Surface low-scoring pairs for physician adjudication using the Clinical Significance Scale |
| **Metrics** | Aggregate dashboard with mean scores, grade distributions, and source-level comparisons |

## Clinical Significance Scale

Physician-adjudicated grading of translation discrepancies:

| Grade | Classification | Definition |
|---|---|---|
| 0 | No error | LLM translation accurately preserves clinical meaning |
| 1 | Minor linguistic error | Stylistic or grammatical difference, no change in clinical meaning |
| 2 | Moderate error | Potential for confusion, unlikely to change clinical management |
| 3 | Clinically significant | Could alter diagnosis, treatment, or disposition |

## Automated Metrics

| Metric | What it measures | Strengths | Limitations |
|---|---|---|---|
| **BLEU** | N-gram overlap (1-4 grams) | Standard MT benchmark, reproducible | Penalizes valid rephrasings |
| **METEOR** | Synonym-aware matching with word order | Handles morphology and synonyms | English-centric stemmer |
| **BERTScore** | Deep semantic similarity via contextual embeddings | Best proxy for meaning preservation | Requires GPU for large batches |

### Metric Definitions (Research Context)

#### BLEU (Bilingual Evaluation Understudy)
- Computes modified n-gram precision between candidate translation and reference (commonly n=1..4).
- Applies a **brevity penalty** so overly short outputs are not rewarded.
- In this project:
  - Browser metric (`lib/metrics.ts`) is a lightweight sentence-level approximation for fast triage.
  - Python metric (`scripts/metrics/compute_all.py`) uses NLTK `sentence_bleu` with smoothing for publishable analysis.

#### METEOR
- Aligns candidate and reference tokens, then combines precision and recall (recall-weighted).
- Includes penalties for fragmented alignments (poor word order) and can incorporate stems/synonyms.
- In this project:
  - Browser metric is simplified (token overlap + fragmentation penalty, no full synonym resources).
  - Python metric uses NLTK `single_meteor_score` with WordNet resources for stronger linguistic matching.

#### BERTScore
- Embedding-based metric that compares contextual token representations from pretrained transformer models.
- Produces:
  - **Precision**: how much candidate content is supported by the reference.
  - **Recall**: how much reference meaning is captured by the candidate.
  - **F1**: harmonic mean of precision and recall; primary summary metric in many papers.
- In this project:
  - Browser uses a **BERT proxy** (n-gram cosine similarity) for instant feedback.
  - Python pipeline computes true BERTScore via the `bert_score` package.

### Interpreting Metric Values Safely

- Higher automated scores usually indicate better lexical/semantic agreement with the reference, but they do **not** guarantee clinical safety.
- Clinical translation risk often comes from small but critical errors (negation, dosage, temporality) that metrics can miss.
- Therefore, MedTranslate pairs automated metrics with physician adjudication via the Clinical Significance Scale.

## Roadmap

- [x] **Phase 1**: Batch translation research tool (this repo)
- [ ] **Phase 2**: Real-time text translation interface with confidence indicators
- [ ] **Phase 3**: Voice input via speech-to-text, HIPAA-compliant deployment, EHR integration

## Data Licensing

- ClinSpEn corpus: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- UMass EHR pairs: [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/)

If using this tool or its outputs in research, please cite the original data sources:

> Miranda-Escalada, A., et al. (2022). ClinSpEn: Clinical Spanish-English parallel corpora. Zenodo. doi:10.5281/zenodo.7711516

## License

MIT
