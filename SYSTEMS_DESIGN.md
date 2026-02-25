# Systems Design — MedTranslate

This document is the canonical design specification for MedTranslate. It describes every visual element, interaction pattern, design token, and component in the system. Use it as the single source of truth when adding new features, modifying existing UI, or onboarding new contributors.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Information Architecture](#information-architecture)
3. [Design Tokens](#design-tokens)
4. [Typography](#typography)
5. [Color System](#color-system)
6. [Spacing & Layout](#spacing--layout)
7. [Elevation & Shadow](#elevation--shadow)
8. [Component Library](#component-library)
9. [Page Specifications](#page-specifications)
10. [Interaction Patterns](#interaction-patterns)
11. [Responsive Behavior](#responsive-behavior)
12. [Theming (Light / Dark)](#theming-light--dark)
13. [Animations & Transitions](#animations--transitions)
14. [Iconography](#iconography)
15. [Accessibility](#accessibility)
16. [How to Add or Modify Elements](#how-to-add-or-modify-elements)

---

## Design Philosophy

MedTranslate targets clinical researchers and physician reviewers. The visual language follows these principles:

| Principle | Rationale |
|---|---|
| **Calm academic tone** | Avoid bright saturated UI; use muted neutrals so dense text is comfortable to read |
| **Data-forward layout** | Tables and metrics dominate; chrome is minimal |
| **Progressive disclosure** | Upload → Translate → Review → Metrics is a linear workflow; each page reveals only what is needed |
| **Trust through precision** | Metric values show 3–4 decimal places; library versions are always visible; grading definitions are explicit |
| **Minimal decoration** | No hero images, illustrations, or marketing language — this is a research instrument |

---

## Information Architecture

The application follows a strict four-step linear workflow, enforced by the navigation bar:

```
┌──────────┐     ┌─────────────┐     ┌──────────┐     ┌──────────┐
│  Upload   │ ──> │  Translate   │ ──> │  Review   │ ──> │  Metrics  │
│   (/)     │     │ (/translate) │     │ (/review) │     │ (/metrics)│
└──────────┘     └─────────────┘     └──────────┘     └──────────┘
```

| Step | Route | Purpose |
|---|---|---|
| **Upload** | `/` | Import dataset, configure model, set system prompt |
| **Translate** | `/translate` | Submit job, monitor progress, view per-row results |
| **Review** | `/review` | Physician grades flagged translations (METEOR < threshold) |
| **Metrics** | `/metrics` | Aggregate dashboard — corpus BLEU, METEOR/BERTScore stats, grade distribution |

Navigation is rendered by `components/Header.tsx`. The active tab uses an accent-colored bottom border; inactive tabs use muted text.

---

## Design Tokens

All visual values are defined as CSS custom properties in `src/design-system/tokens.css` (light) and `src/design-system/theme.css` (dark). No hard-coded colors, shadows, or radii should appear in component code.

### Token Reference

```css
/* tokens.css — :root (light mode defaults) */

/* Backgrounds */
--bg-base:           #F0F1F0     /* Page background */
--bg-surface:        #FFFFFF     /* Card / panel background */
--bg-surface-hover:  #FAFBFA     /* Card hover state */
--bg-inset:          #F6F7F6     /* Recessed areas (code blocks, inputs) */

/* Text */
--text-primary:      #1A1D1A     /* Headings, body text */
--text-secondary:    #52584F     /* Secondary labels, table cells */
--text-muted:        #8A8F87     /* Captions, placeholders, disabled */

/* Accent (green — clinical/medical) */
--accent:            #1B7340     /* Primary buttons, active tabs */
--accent-soft:       #E8F5ED     /* Hover backgrounds, highlights */
--accent-hover:      #145A32     /* Button hover */
--accent-text:       #1B7340     /* Accent-colored text */
--accent-bright:     #22C55E     /* Metric values, emphasis */

/* Borders */
--border:            #DFE2DC     /* Default borders */
--border-subtle:     #EBEEE9     /* Table rows, dividers */

/* Semantic */
--success:           #16A34A
--success-light:     #E8F5ED
--success-border:    #BBF7D0
--warning:           #CA8A04
--warning-light:     #FEFCE8
--warning-border:    #FDE68A
--danger:            #DC2626
--danger-light:      #FEF2F2
--danger-border:     #FECACA

/* Shadows */
--shadow:            0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.06)
--shadow-hover:      0 2px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)
--shadow-lg:         0 4px 12px rgba(0,0,0,0.05), 0 12px 40px rgba(0,0,0,0.08)

/* Radii */
--radius:            20px        /* Cards, large containers */
--radius-sm:         12px        /* Buttons, inputs */
--radius-xs:         8px         /* Badges, small elements */

/* Font */
--font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```

### Tailwind Semantic Colors

Extended in `tailwind.config.ts` for use with utility classes:

| Token | Value | Usage |
|---|---|---|
| `clinical-safe` | `#10b981` | Grade 0 (no error) |
| `clinical-minor` | `#f59e0b` | Grade 1 (minor linguistic) |
| `clinical-moderate` | `#f97316` | Grade 2 (moderate) |
| `clinical-critical` | `#ef4444` | Grade 3 (clinically significant) |
| `surface-900` | `#0a0f1a` | Deepest dark surface |
| `surface-800` | `#111827` | Dark card background |
| `surface-700` | `#1e293b` | Dark inset |
| `surface-600` | `#334155` | Dark border area |

---

## Typography

| Element | Size | Weight | Color | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Page title | 32px | 700 | `--text-primary` | -0.025em | 1.2 |
| Page subtitle | 14px | 400 | `--text-muted` | normal | 1.5 |
| Section label | 11px | 700 | `--text-muted` | 0.06em | normal |
| Table header | 11px | 600 | `--text-muted` | 0.06em | normal |
| Table cell | 14px | 400 | `--text-secondary` | normal | 1.55 |
| Body text | 14px | 400 | `--text-primary` | normal | 1.55 |
| Metric value | 52px | 700 | `--accent-text` | normal | 1.0 |
| Button (default) | 13px | 600 | varies | normal | 1.0 |
| Button (small) | 12px | 600 | varies | normal | 1.0 |
| Badge | 11px | 600 | varies | normal | 1.0 |
| Badge (dataset) | 10px | 600 | varies | normal | 1.0 |
| Nav link | 14px | 500 | `--text-muted` / `--accent-text` | normal | 1.0 |

**Font stack**: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

All text uses the system font. No custom webfonts are loaded in the current production build.

---

## Color System

### Clinical Grade Palette

These colors communicate clinical severity and must not be used for decorative purposes.

| Grade | Label | Hex | CSS Variable | Usage |
|---|---|---|---|---|
| 0 | No error | `#10b981` | `clinical-safe` | Grade buttons, bars, dots |
| 1 | Minor linguistic | `#f59e0b` | `clinical-minor` | Grade buttons, bars, dots |
| 2 | Moderate error | `#f97316` | `clinical-moderate` | Grade buttons, bars, dots |
| 3 | Clinically significant | `#ef4444` | `clinical-critical` | Grade buttons, bars, dots |

### Semantic Colors

| Role | Light | Dark | Usage |
|---|---|---|---|
| Success | `#16A34A` | `#34D399` | Completed jobs, positive indicators |
| Warning | `#CA8A04` | `#FBBF24` | Scoring in progress, caution states |
| Danger | `#DC2626` | `#F87171` | Failed rows, error messages |
| Accent | `#1B7340` | `#4ADE80` | Active navigation, primary buttons, metric values |

### Dataset Badges

| Dataset | Light Background | Light Text | Dark Background | Dark Text |
|---|---|---|---|---|
| ClinSpEn | `--accent-soft` | `--accent-text` | rgba accent 10% | accent |
| UMass | `#F3E8FF` | `#7C3AED` | rgba(124,58,237,0.12) | `#A78BFA` |

---

## Spacing & Layout

### Page Layout

```
┌───────────────────────────────────────────────────────────────┐
│  max-width: 1280px  |  margin: 0 auto  |  padding: 48px 24px │
│                                                               │
│  ┌───────────────────────────────────────────────────────────┐│
│  │  Header (nav bar)                           [Theme Toggle]││
│  │  margin-bottom: 48px                                      ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌───────────────────────────────────────────────────────────┐│
│  │  PageHeader (title + subtitle)                            ││
│  │  margin-bottom: 40px                                      ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌───────────────────────────────────────────────────────────┐│
│  │  Page content                                             ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

### Spacing Scale

| Usage | Value |
|---|---|
| Page padding | 48px top/bottom, 24px sides |
| Card padding | 32px |
| Card inner sections | 24px |
| Section gap | 32px |
| Form field gap | 16px |
| Table cell padding | 16px horizontal, 14–16px vertical |
| Badge padding | 3px 10px (standard), 2px 8px (dataset) |
| Button padding | 10px 24px (default), 6px 14px (small) |

---

## Elevation & Shadow

Three shadow levels create depth hierarchy:

| Level | Token | Value | Usage |
|---|---|---|---|
| **Default** | `--shadow` | `0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.06)` | Cards, containers at rest |
| **Hover** | `--shadow-hover` | `0 2px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)` | Cards on hover |
| **Large** | `--shadow-lg` | `0 4px 12px rgba(0,0,0,0.05), 0 12px 40px rgba(0,0,0,0.08)` | Modals, detail panels |

Dark mode uses higher opacity values (0.2–0.4) for shadows to remain visible on dark surfaces.

---

## Component Library

All reusable components live in two directories:

- **`src/design-system/primitives/`** — Base-level UI primitives (design tokens aware)
- **`components/`** — App-specific composed components

### Primitives (`src/design-system/`)

#### Card

Container component for content sections.

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | ReactNode | — | Card content |
| `hover` | boolean | `true` | Enable shadow lift on hover |
| `padding` | `"none"` \| `"default"` | `"default"` | `"default"` = 32px, `"none"` = 0 |

```
┌──────────────────────────────────────┐
│  (32px padding)                      │
│                                      │
│  Content area                        │
│                                      │
│                                      │
└──────────────────────────────────────┘
  bg: --bg-surface
  radius: --radius (20px)
  shadow: --shadow → --shadow-hover on hover
```

#### Button

| Prop | Type | Default | Description |
|---|---|---|---|
| `variant` | `"primary"` \| `"secondary"` \| `"ghost"` | `"primary"` | Visual style |
| `size` | `"default"` \| `"sm"` | `"default"` | Size variant |
| `disabled` | boolean | `false` | Disabled state (opacity 0.4) |

```
Primary:    [bg: --accent]  [text: white]  [hover: --accent-hover]
Secondary:  [bg: transparent] [border: --border] [text: --text-secondary]
Ghost:      [bg: transparent] [text: --text-muted]
```

#### Badge

| Prop | Type | Description |
|---|---|---|
| `variant` | `"success"` \| `"warning"` \| `"danger"` \| `"accent"` \| `"dataset"` \| `"dataset-alt"` | Color scheme |

```
Success:      bg: --success-light  text: --success  border: --success-border
Warning:      bg: --warning-light  text: --warning  border: --warning-border
Danger:       bg: --danger-light   text: --danger   border: --danger-border
Accent:       bg: --accent-soft    text: --accent-text
Dataset:      bg: --accent-soft    text: --accent-text  (smaller)
Dataset-alt:  bg: #F3E8FF         text: #7C3AED        (UMass purple)
```

#### MetricValue

Displays a large numeric metric with label and optional details.

| Prop | Type | Description |
|---|---|---|
| `label` | string | Uppercase label above the value |
| `children` | ReactNode | The metric value (typically large text) |
| `detail` | ReactNode? | Small text below the value |
| `badge` | ReactNode? | Optional badge below detail |

```
┌─────────────────────────┐
│  CORPUS BLEU            │  ← 11px, uppercase, muted
│  42.31                  │  ← 52px, bold, accent
│  BLEU = 42.31 65.2/...  │  ← 13px, muted (detail)
│  [sacrebleu 2.4.3]      │  ← optional badge
└─────────────────────────┘
```

#### ProgressBar

| Prop | Type | Description |
|---|---|---|
| `value` | number (0–100) | Percentage filled |
| `label` | string? | Left label above bar |
| `labelRight` | string? | Right label above bar |

```
Translating...              450 / 1000
┌──────────────────────────────────────┐
│████████████████████░░░░░░░░░░░░░░░░░│  ← 4px height
└──────────────────────────────────────┘
  track: --border  |  fill: --accent  |  transition: 0.6s
```

#### GradeRow

Renders a single row in the grade distribution chart.

| Prop | Type | Description |
|---|---|---|
| `label` | string | Grade label text |
| `dotColor` | string | Color of the dot indicator |
| `barColor` | string | Color of the horizontal bar |
| `count` | number | Number of items with this grade |
| `maxCount` | number | Maximum count (for bar width %) |

```
  ● No error            ██████████████████████████    124
  ● Minor linguistic    ████████                       31
  ● Moderate error      ███                            12
  ● Critical            █                               4
```

#### SectionLabel

Horizontal rule with label text. Used to divide content sections.

```
  CORPUS METRICS ────────────────────────────────────
```

#### PageHeader

Page title and optional subtitle.

| Prop | Type | Description |
|---|---|---|
| `title` | string | 32px bold heading |
| `subtitle` | ReactNode? | 14px muted description |

#### ThemeProvider

React context provider for light/dark mode toggling.

- Persists choice to `localStorage` key `medtranslate-theme`
- Sets `data-theme` attribute on `<html>` element
- Consumed via `useTheme()` hook → `{ theme, toggleTheme }`

### App Components (`components/`)

#### Header

Top navigation bar. Renders four workflow tabs (Upload, Translate, Review, Metrics) and a theme toggle button.

- Active tab: `color: --accent-text`, `border-bottom: 2px solid --accent`
- Inactive tab: `color: --text-muted`, `border-bottom: 2px solid transparent`
- Theme toggle: pill-shaped button in top-right corner

#### StatusPill

Job row status badge. Maps status to semantic color:

| Status | Background | Text | Border |
|---|---|---|---|
| `pending` | `--bg-inset` | `--text-muted` | `--border` |
| `translating` | `--accent-soft` | `--accent-text` | `--accent` |
| `scoring` | `--warning-light` | `--warning` | `--warning-border` |
| `complete` | `--success-light` | `--success` | `--success-border` |
| `error` | `--danger-light` | `--danger` | `--danger-border` |

#### GradeSelector

Interactive grade input. Renders four buttons (Grade 0–3) with clinical labels and color coding.

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `ClinicalGrade \| null` | — | Currently selected grade |
| `onChange` | `(grade: ClinicalGrade) => void` | — | Selection callback |
| `compact` | boolean | `false` | Smaller size, no labels |

- Selected button: `bg: --accent-soft`, `border: --accent`, `color: --accent-text`
- Unselected button: `bg: transparent`, `border: --border`, `color: --text-secondary`

#### PairDetail

Expanded detail panel for a single translation pair. Shows three columns of text and metrics.

```
┌──────────────────────────────────────────────────────────────────┐
│  clinspen_doc1_L5                                          [×]   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Spanish      │  │ English Ref  │  │ LLM Output   │          │
│  │ Source       │  │              │  │              │          │
│  │ (scrollable) │  │ (scrollable) │  │ (scrollable) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  METEOR  0.872   BERTSCORE F1  0.923     [0] [1] [2] [3]       │
└──────────────────────────────────────────────────────────────────┘
```

- Three columns: `bg: --bg-inset`, `border-radius: --radius-xs`, max-height 176px with overflow scroll
- Metric values displayed inline with label
- GradeSelector rendered on the right

#### MetricsCard

Standalone metric display used on the Metrics page.

| Prop | Type | Description |
|---|---|---|
| `label` | string | Uppercase label |
| `value` | `number \| null` | Metric value (displays `.toFixed(3)` or "--") |
| `description` | string? | Explanatory text |
| `count` | number? | Sample size shown as "n = X" |

---

## Page Specifications

### Upload Page (`/`)

**Purpose**: Import a CSV/XLSX dataset and configure the translation job.

**Layout**:
```
┌─────────────────────────────────────────────────┐
│  PageHeader: "Upload Dataset"                   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Drop Zone                         │   │
│  │  ┌─────────────────────────────────┐     │   │
│  │  │  Drag & drop or click to upload │     │   │
│  │  │  .csv, .xlsx (up to 50MB)       │     │   │
│  │  └─────────────────────────────────┘     │   │
│  │                                           │   │
│  │  [File info: name, row count]            │   │
│  │  [Remove file button]                     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Configuration                     │   │
│  │  System prompt (textarea)                │   │
│  │  Row limit (number input)                │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Continue to Translate →]                      │
└─────────────────────────────────────────────────┘
```

**Interactions**:
- File input accepts `.csv` and `.xlsx`
- XLSX parsing happens server-side via backend (security: no client-side XLSX)
- After file selection, row count displays immediately
- "Remove file" clears localStorage and resets state
- System prompt textarea pre-filled with medical interpreter default
- Continue button navigates to `/translate`

### Translate Page (`/translate`)

**Purpose**: Submit translation job and display real-time results.

**Layout**:
```
┌─────────────────────────────────────────────────┐
│  PageHeader: "Translation"                      │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Job Controls                      │   │
│  │  [Start Translation]  [Cancel]           │   │
│  │  ProgressBar (translated / total)        │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Results Table                     │   │
│  │  ┌─────────────────────────────────────┐ │   │
│  │  │ ID | Source | Status | METEOR | ... │ │   │
│  │  │ ─────────────────────────────────── │ │   │
│  │  │ row 1                               │ │   │
│  │  │ row 2                               │ │   │
│  │  │ ...                                 │ │   │
│  │  └─────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [Export CSV]  [Continue to Review →]           │
└─────────────────────────────────────────────────┘
```

**Interactions**:
- "Start Translation" → `POST /v1/jobs` then poll every 2s
- Progress bar updates with translated/total count
- Table rows populate in real-time as results arrive
- Each row shows StatusPill (pending → translating → scoring → complete/error)
- Clicking a row opens PairDetail modal
- "Cancel" → `POST /v1/jobs/{id}/cancel`
- Export downloads CSV with all metrics
- Session persisted to IndexedDB for large datasets

### Review Page (`/review`)

**Purpose**: Physician-adjudicated clinical significance grading.

**Layout**:
```
┌─────────────────────────────────────────────────┐
│  PageHeader: "Clinical Review"                  │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Review Configuration              │   │
│  │  METEOR threshold: [0.4]  Flagged: 42   │   │
│  │  Progress: 12 / 42 graded               │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  PairDetail (current pair)               │   │
│  │  Three-column text comparison            │   │
│  │  Metrics + GradeSelector                 │   │
│  │  [← Previous]  [Next →]                  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Card: Grade Distribution                │   │
│  │  GradeRow × 4                            │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Interactions**:
- METEOR threshold is configurable (default 0.4)
- Pairs below threshold are queued for review
- Physician reads three-column comparison and assigns grade 0–3
- Navigation buttons move through the queue
- Jump-to-pair functionality for non-linear review
- Grades stored in both localStorage and IndexedDB
- Grade distribution card updates in real-time

### Metrics Page (`/metrics`)

**Purpose**: Aggregate dashboard of all translation quality metrics.

**Layout**:
```
┌─────────────────────────────────────────────────┐
│  PageHeader: "Metrics Dashboard"                │
│                                                 │
│  CORPUS BLEU ────────────────────────────       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │ Overall    │ │ ClinSpEn   │ │ UMass      │  │
│  │ 42.31     │ │ 44.56     │ │ 39.12     │  │
│  └────────────┘ └────────────┘ └────────────┘  │
│                                                 │
│  SENTENCE METRICS ───────────────────────       │
│  ┌────────────┐ ┌────────────┐                  │
│  │ METEOR     │ │ BERTScore  │                  │
│  │ Mean: 0.74 │ │ Mean: 0.89 │                  │
│  │ Std: 0.18  │ │ Std: 0.07  │                  │
│  └────────────┘ └────────────┘                  │
│                                                 │
│  CLINICAL GRADES ────────────────────────       │
│  GradeRow × 4                                   │
│                                                 │
│  LIBRARY VERSIONS ───────────────────────       │
│  sacrebleu 2.4.3 | nltk 3.9.1 | ...            │
└─────────────────────────────────────────────────┘
```

---

## Interaction Patterns

### Hover States

| Element | Default | Hover |
|---|---|---|
| Card | `--shadow` | `--shadow-hover`, `--bg-surface-hover` background |
| Button (primary) | `--accent` bg | `--accent-hover` bg |
| Button (secondary) | `--border` border | `--accent-soft` bg |
| Table row | transparent | `--accent-soft` bg |
| Nav link | `--text-muted` | `--accent-text` |

### Active / Selected States

| Element | Active State |
|---|---|
| Nav tab | `--accent-text` color, 2px `--accent` bottom border |
| Grade button | `--accent-soft` bg, `--accent` border, `--accent-text` color |

### Disabled States

All disabled interactive elements use `opacity: 0.4` and `cursor: not-allowed`.

### Loading States

- Translation job: ProgressBar with shimmer animation
- Polling: 2-second interval with real-time table row updates
- StatusPill transitions: pending → translating → scoring → complete

### Error States

- Failed translation rows: StatusPill with `danger` variant
- PairDetail shows error message in `--danger-light` background
- Job failure: Error message displayed in a Card with danger styling

---

## Responsive Behavior

The application targets desktop browsers (1024px+) used in clinical research settings.

| Breakpoint | Behavior |
|---|---|
| ≥ 1280px | Content centered with max-width |
| 1024–1279px | Content fills available width with 24px side padding |
| < 1024px | Not explicitly optimized — functional but not designed for mobile |

PairDetail three-column layout stacks when viewport narrows below the minimum content width.

---

## Theming (Light / Dark)

Theme is toggled via the pill button in the Header and managed by `ThemeProvider`.

**Mechanism**:
1. `ThemeProvider` sets `data-theme="light"` or `data-theme="dark"` on `<html>`
2. `tokens.css` defines `:root` (light) defaults
3. `theme.css` defines `[data-theme="dark"]` overrides
4. All components reference CSS variables — no conditional styling in JS

**Key Dark Mode Overrides**:

| Token | Light | Dark |
|---|---|---|
| `--bg-base` | `#F0F1F0` | `#0F1210` |
| `--bg-surface` | `#FFFFFF` | `#181C19` |
| `--text-primary` | `#1A1D1A` | `#E8EAE6` |
| `--accent` | `#1B7340` | `#4ADE80` |
| `--border` | `#DFE2DC` | `#262C28` |
| `--shadow` | low-opacity | high-opacity (0.2–0.25) |

**Persistence**: Theme preference stored in `localStorage` key `medtranslate-theme`.

**Transition**: All themed elements have a `0.3s ease` transition on `background-color`, `color`, `border-color`, and `box-shadow`.

---

## Animations & Transitions

### Entry Animation (fadeUp)

Used on page load for staggered card entrance:

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

.anim { animation: fadeUp 0.45s ease forwards; opacity: 0; }
.d1 { animation-delay: 0.04s; }
.d2 { animation-delay: 0.08s; }
/* ... up to .d6 at 0.24s */
```

Apply class `anim d1`, `anim d2`, etc., to successive cards for a staggered reveal.

### Transition Durations

| Element | Property | Duration | Easing |
|---|---|---|---|
| Card shadow | `box-shadow` | 0.25s | ease |
| Card background | `background-color` | 0.35s | ease |
| Button all | all | 0.2s | ease |
| Table row bg | `background` | 0.15s | ease |
| Theme change | bg, color, border, shadow | 0.3s | ease |
| Progress bar | width | 0.6s | ease |
| Grade bar | width | 0.5s | ease |
| Nav link | color, border-color | 0.2s | ease |

### Shimmer Animation

Progress bar fill uses a gradient shimmer during active loading states.

---

## Iconography

Icons use **Lucide React** (`lucide-react` v0.468.0) — a clean, minimal SVG icon set.

Usage pattern:
```tsx
import { Upload, ChevronRight, X } from "lucide-react";
<Upload size={20} strokeWidth={1.5} />
```

Guidelines:
- Default size: 16–20px
- Stroke width: 1.5
- Color: inherit from parent text color via `currentColor`
- Do not mix icon libraries

---

## Accessibility

### Current Implementation

- **Semantic HTML**: Buttons use `<button>`, links use `<Link>`, tables use `<table>`/`<th>`/`<td>`
- **Focus styles**: Default browser focus outlines are preserved
- **Color contrast**: Light mode and dark mode token pairs maintain WCAG AA contrast ratios
- **Title attributes**: Grade buttons include full-text descriptions as `title`
- **No motion preference**: `prefers-reduced-motion` is not currently implemented

### Recommendations for Enhancement

- Add `aria-label` to icon-only buttons (e.g., close button in PairDetail)
- Implement `prefers-reduced-motion` media query to disable `fadeUp` animation
- Add `role="status"` to ProgressBar for screen reader progress announcements
- Ensure all interactive elements have visible focus rings in both themes

---

## How to Add or Modify Elements

### Adding a New Design Token

1. Define the light-mode value in `src/design-system/tokens.css` under `:root`
2. Define the dark-mode override in `src/design-system/theme.css` under `[data-theme="dark"]`
3. Reference the token in components using `var(--your-token)`
4. If also needed as a Tailwind utility, add it to `tailwind.config.ts` under `theme.extend.colors`

### Adding a New Primitive Component

1. Create the file in `src/design-system/primitives/YourComponent.tsx`
2. Accept standard HTML attributes via spread: `...props: React.HTMLAttributes<HTMLDivElement>`
3. Use CSS variables for all colors, shadows, and radii — never hard-code hex values
4. Export from `src/design-system/index.ts`
5. Document props and visual behavior in this file

### Adding a New App Component

1. Create the file in `components/YourComponent.tsx`
2. Compose from primitives where possible (Card, Button, Badge, etc.)
3. Use `"use client"` directive if the component uses hooks or browser APIs
4. Import types from `lib/types.ts`

### Adding a New Page

1. Create `app/your-route/page.tsx`
2. Follow the standard page structure:
   ```tsx
   "use client";
   import Header from "@/components/Header";
   import { PageHeader, Card } from "@/src/design-system";

   export default function YourPage() {
     return (
       <div style={{ maxWidth: 1280, margin: "0 auto", padding: "48px 24px" }}>
         <Header />
         <PageHeader title="Page Title" subtitle="Description" />
         <Card>
           {/* Content */}
         </Card>
       </div>
     );
   }
   ```
3. Add the route to `NAV_ITEMS` in `components/Header.tsx` if it should appear in navigation
4. Document the page in this file under [Page Specifications](#page-specifications)

### Modifying the Color Palette

1. Update the CSS variable in `tokens.css` (light) and `theme.css` (dark)
2. Verify contrast ratios using a WCAG checker (aim for AA minimum: 4.5:1 for text)
3. Test both themes by toggling the theme button
4. Update the Tailwind config if the color is used with utility classes

### Adding a New Clinical Grade

If the grading scale changes:

1. Update `CLINICAL_GRADES` in `lib/types.ts` — this is the single source of truth for grade definitions
2. Update `GradeSelector.tsx` to render the new grade button
3. Update `GradeRow` usage on the Metrics and Review pages
4. Add the new grade color to `tailwind.config.ts` under `clinical`
5. Update this document's [Clinical Grade Palette](#clinical-grade-palette) section

### Modifying Table Styles

Global table styles live in `app/globals.css`. To override for a specific table, use inline styles or a wrapper class. Do not modify globals unless the change applies to all tables.

### Working with the Design System Exports

All primitives are barrel-exported from `src/design-system/index.ts`:

```tsx
import { Card, Button, Badge, MetricValue, ProgressBar, PageHeader, SectionLabel, GradeRow, ThemeProvider, useTheme } from "@/src/design-system";
```

Always import from the barrel export, not from individual primitive files.
