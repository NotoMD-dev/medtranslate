# Changelog

All notable changes to the MedTranslate project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0] - 2026-02-21

### Added

- **Initial platform release**: Full clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations.

#### Web Application
- **Upload page** (`app/page.tsx`): CSV and XLSX file upload with drag-and-drop support, system prompt configuration, and configurable row limits.
- **Translate page** (`app/translate/page.tsx`): Batch translation runner with live progress bar, per-row status tracking, abort capability, and CSV export.
- **Review page** (`app/review/page.tsx`): Clinical safety review interface that surfaces translation pairs with BLEU < 0.4 for physician adjudication using the 0–3 Clinical Significance Scale.
- **Metrics page** (`app/metrics/page.tsx`): Aggregate metrics dashboard showing mean BLEU, METEOR, and BERTProxy scores, clinical grade distributions, and source-level performance comparisons.
- **Translation API route** (`app/api/translate/route.ts`): Server-side endpoint supporting both OpenAI and Anthropic LLM providers with automatic routing based on model name.

#### Components
- `Header`: Navigation bar with Upload/Translate/Review/Metrics workflow tabs.
- `MetricsCard`: Metric value display card with label, mean, and sample count.
- `PairDetail`: Three-column detail panel showing Spanish source, English reference, and LLM translation with inline metric scores and grade selector.
- `GradeSelector`: Four-button control for assigning clinical significance grades 0–3.
- `StatusPill`: Colored status badge (pending, translating, scoring, complete, error).

#### Libraries
- `lib/metrics.ts`: Client-side BLEU (with Method 1 smoothing), METEOR (with fragmentation penalty), and BERTProxy (n-gram cosine similarity) implementations.
- `lib/csv.ts`: CSV parsing, XLSX parsing, CSV export, and browser file download utilities.
- `lib/session.ts`: localStorage-based session state persistence for data, prompt, row limit, and results.
- `lib/types.ts`: TypeScript interfaces for `TranslationPair`, `TranslationResult`, `ClinicalGrade`, `MetricsSummary`, and `TranslationConfig`.

#### Python Scripts
- `scripts/build_dataset.py`: Unified corpus builder that combines ClinSpEn clinical case reports and UMass EHR pairs into a single normalized CSV.
- `scripts/translate_batch.py`: Headless batch translation runner with checkpoint support (every 50 rows), configurable delay, start index, and row limit.
- `scripts/metrics/compute_all.py`: Research-grade metrics pipeline computing BLEU (NLTK), METEOR (NLTK with WordNet), and BERTScore (precision, recall, F1) with per-source breakdowns.

#### Configuration
- Next.js 15 with App Router and 10 MB body size limit.
- Tailwind CSS with custom dark theme (surface colors, accent colors, clinical grade colors).
- IBM Plex Sans and IBM Plex Mono typography via Google Fonts.
- `.env.example` template for API key configuration.
- `.gitignore` covering environment files, data files, build artifacts, and IDE files.

### Fixed

- **BLEU smoothing alignment** (`f8b09e0`): Added Method 1 smoothing to client-side BLEU computation to match the Python NLTK backend, preventing sentence-level BLEU from collapsing to zero when any n-gram order has no matches.

- **State persistence across tabs** (`13011f8`, `6db2980`): Fixed state loss when navigating between Upload, Translate, Review, and Metrics tabs. Translation results, system prompt, and uploaded data now persist across tab navigation via localStorage.

- **Session persistence across page reloads** (`5d2f92e`, `9e85cf2`, `f4ad59d`): Implemented localStorage-based session management so that translation progress, uploaded datasets, and configuration survive page refreshes and browser restarts.

- **Metrics page wiring** (`6db2980`): Connected the Metrics page to the shared session store so it correctly reads completed translation results and computes aggregate statistics.

### Enhanced

- **XLSX upload support** (`18084aa`): Added support for uploading `.xlsx` and `.xls` files in addition to `.csv`, using the `xlsx` library for parsing.
- **File delete** (`18084aa`): Added a "Remove file" button on the Upload page to clear the current dataset and reset session state.
- **Custom row limit** (`18084aa`): Added the ability to select "Entire file" or "Custom number of rows" before starting batch translation, allowing researchers to run partial experiments.

---

## Version History Summary

| Date | Commit | Change |
|---|---|---|
| 2026-02-20 | `f436f22` | Initial commit: full platform with all pages, components, libraries, and scripts |
| 2026-02-20 | `8509136` | Updated `.env.example` template |
| 2026-02-20 | `a7e8296` | Regenerated lockfile after merge |
| 2026-02-21 | `18084aa` | Added XLSX upload support, file delete, and custom row limit |
| 2026-02-21 | `9f87cc7` | Added `next-env.d.ts` generated by Next.js build |
| 2026-02-21 | `f587ece` | Expanded architecture and metric documentation in README |
| 2026-02-21 | `8e6dc76` | Committed lockfile, TypeScript version pin, and tsbuildinfo |
| 2026-02-21 | `6db2980` | Fixed state persistence across tab navigation and wired up Metrics page |
| 2026-02-21 | `13011f8` | Persisted translation state across tabs and pages |
| 2026-02-21 | `f8b09e0` | Added Method 1 smoothing to client-side BLEU to match Python backend |
| 2026-02-20 | `9e85cf2` | Updated translate page for data persistence |
| 2026-02-20 | `5d2f92e` | Updated session library for cross-session persistence |
| 2026-02-21 | `f4ad59d` | Improved translation page state persistence during navigation |
