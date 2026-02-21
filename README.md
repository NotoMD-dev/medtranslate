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
