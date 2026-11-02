import type { TranslationPair, SentenceMetrics, ClinicalGrade, ReferenceFlag, RefusalOverride, HeadToHeadJudgment } from "./types";
import { LANGUAGES } from "./types";
import { rowStatus as classifyRow } from "./metrics";

// ---------------------------------------------------------------------------
// Shared CSV helpers
// ---------------------------------------------------------------------------

/** Escape a value for CSV output: quote if it contains commas, quotes, or newlines. */
function escapeCSV(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSVString(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export interface DetectedColumns {
  sourceColumn: string | null;
  referenceColumn: string | null;
  /** Language codes implied by the column names; null for generic columns. */
  sourceLanguage: string | null;
  targetLanguage: string | null;
}

/**
 * Work out the source and reference columns from a header row.
 *
 * The standard format names each column after its language:
 * `<language>_source` holds the text to translate and `<language>_reference`
 * the human translation it is scored against, e.g. `spanish_source` +
 * `english_reference` (Spanish to English) or `english_source` +
 * `spanish_reference` (English to Spanish). Generic `source_text` /
 * `reference_text` columns are also accepted, in which case the direction is
 * chosen on the Upload page. `english_reference` is still accepted as the
 * reference column for files made for older versions.
 */
export function detectColumns(headers: string[]): DetectedColumns {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const has = (c: string) => lower.includes(c);
  const srcLang = LANGUAGES.find((l) => has(`${l.name}_source`));
  const refLang = LANGUAGES.find((l) => has(`${l.name}_reference`));
  const sourceColumn = srcLang ? `${srcLang.name}_source` : has("source_text") ? "source_text" : null;
  const referenceColumn = refLang ? `${refLang.name}_reference` : has("reference_text") ? "reference_text" : null;
  return {
    sourceColumn,
    referenceColumn,
    sourceLanguage: srcLang?.code ?? null,
    targetLanguage: refLang?.code ?? null,
  };
}

/** Header row of a CSV string (empty when the text has no rows). */
export function csvHeaders(text: string): string[] {
  const first = text.split("\n").find((l) => l.trim());
  return first ? parseCSVLine(first).map((h) => h.trim()) : [];
}

/**
 * Parse a CSV string into TranslationPair objects.
 * Handles quoted fields with commas and newlines.
 */
export function parseCSV(
  text: string,
  columns?: { sourceColumn?: string | null; referenceColumn?: string | null },
): TranslationPair[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const detected = detectColumns(headers);
  const srcCol = (columns?.sourceColumn && headers.includes(columns.sourceColumn) ? columns.sourceColumn : null) ?? detected.sourceColumn;
  const refCol = (columns?.referenceColumn && headers.includes(columns.referenceColumn) ? columns.referenceColumn : null) ?? detected.referenceColumn;

  const missing: string[] = [];
  if (!srcCol) missing.push('a source column such as "spanish_source" or "english_source"');
  if (!refCol) missing.push('a reference column such as "english_reference" or "spanish_reference"');
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Name the columns after their languages so the app knows which way to translate. Found: ${headers.join(", ")}`,
    );
  }

  const rows: TranslationPair[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ""; });

    const sourceText = obj[srcCol!] || "";
    rows.push({
      pair_id: obj.pair_id || `row_${i}`,
      source: obj.source || "ClinSpEn_ClinicalCases",
      content_type: obj.content_type || "clinical_case_report",
      english_reference: obj[refCol!] || "",
      source_text: sourceText,
      spanish_source: sourceText,
      // A pre-filled translation (e.g. from an earlier export).
      llm_english_translation: obj.llm_translation || obj.llm_english_translation || "",
    });
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// ---------------------------------------------------------------------------
// CSV export — for backend submission
// ---------------------------------------------------------------------------

// The backend reads the source text from `source_text`; the legacy
// `spanish_source` duplicate is no longer sent (it doubled the upload size).
const SUBMISSION_HEADERS = [
  "pair_id", "source", "content_type", "english_reference",
  "source_text", "llm_english_translation",
  // Optional: lets a metrics-only re-score keep failed rows' status.
  "error", "error_kind",
];

function toSubmissionRow(
  pairId: string, source: string, contentType: string,
  englishRef: string, sourceText: string, translation: string,
  error = "", errorKind = "",
): string[] {
  return [pairId, source, contentType, englishRef, sourceText, translation, error, errorKind];
}

/** Convert TranslationPair[] to a CSV File suitable for backend upload. */
export function pairsToCSVFile(pairs: TranslationPair[], filename = "dataset.csv"): File {
  const rows = pairs.map((r) =>
    toSubmissionRow(
      r.pair_id, r.source, r.content_type,
      r.english_reference, r.source_text || r.spanish_source, r.llm_english_translation,
    ),
  );
  return new File([toCSVString(SUBMISSION_HEADERS, rows)], filename, { type: "text/csv" });
}

/**
 * Convert SentenceMetrics[] to a CSV File for re-submission.
 *
 * With `keepStatus` (default, used for metrics-only re-scoring) each row's
 * translation, error and error_kind are carried over so refused rows stay
 * refused. With `keepStatus: false` (used to retry incomplete rows) the rows
 * are submitted as fresh, untranslated input.
 */
export function sentenceMetricsToCSVFile(
  sentences: SentenceMetrics[],
  filename = "dataset.csv",
  keepStatus = true,
): File {
  const rows = sentences.map((r) =>
    toSubmissionRow(
      r.pair_id, r.source, r.content_type,
      r.english_reference, r.source_text || r.spanish_source,
      keepStatus ? r.llm_english_translation : "",
      keepStatus ? r.error ?? "" : "",
      keepStatus ? r.error_kind ?? "" : "",
    ),
  );
  return new File([toCSVString(SUBMISSION_HEADERS, rows)], filename, { type: "text/csv" });
}

// ---------------------------------------------------------------------------
// CSV export — results download
// ---------------------------------------------------------------------------

/** Row status for exports (same classification the pages use). */
function rowStatus(r: SentenceMetrics): string {
  return classifyRow(r).key;
}

/** Export sentence metrics results to CSV string for the user to download. */
export function exportResultsCSV(
  sentences: SentenceMetrics[],
  grades?: Record<string, ClinicalGrade>,
  refFlags?: Record<string, ReferenceFlag>,
  overrides?: Record<string, RefusalOverride>,
): string {
  const headers = [
    "pair_id", "source", "content_type", "reference_translation", "source_text",
    "llm_translation", "meteor_score", "bertscore_f1",
    "clinical_significance_grade", "reference_flag_issues", "reference_flag_notes",
    "status", "error", "format_warning", "reviewer_override_note",
  ];

  const rows = sentences.map((r) => {
    const flag = refFlags?.[r.pair_id];
    return [
      r.pair_id, r.source, r.content_type, r.english_reference,
      r.source_text || r.spanish_source, r.llm_english_translation,
      r.meteor != null ? r.meteor.toFixed(4) : "",
      r.bertscore_f1 != null ? r.bertscore_f1.toFixed(4) : "",
      grades?.[r.pair_id] != null ? String(grades[r.pair_id]) : "",
      flag ? flag.reasons.join("; ") : "",
      flag?.notes ?? "",
      rowStatus(r),
      r.error ?? "",
      r.format_warning ?? "",
      overrides?.[r.pair_id]?.note ?? "",
    ];
  });

  return [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
}

/**
 * Export only the flagged pairs that went through clinical review.
 * Unlike exportResultsCSV, this skips un-reviewed translations and omits
 * the redundant "error" column — callers should pass the already-filtered
 * `flagged` array from the review page.
 */
export function exportReviewCSV(
  flaggedPairs: SentenceMetrics[],
  grades?: Record<string, ClinicalGrade>,
  refFlags?: Record<string, ReferenceFlag>,
  overrides?: Record<string, RefusalOverride>,
): string {
  const headers = [
    "pair_id", "source", "content_type", "reference_translation", "source_text",
    "llm_translation", "meteor_score", "bertscore_f1",
    "clinical_significance_grade", "reference_flag_issues", "reference_flag_notes",
    "status", "error", "format_warning", "reviewer_override_note",
  ];

  const rows = flaggedPairs.map((r) => {
    const flag = refFlags?.[r.pair_id];
    return [
      r.pair_id, r.source, r.content_type, r.english_reference,
      r.source_text || r.spanish_source, r.llm_english_translation,
      r.meteor != null ? r.meteor.toFixed(4) : "",
      r.bertscore_f1 != null ? r.bertscore_f1.toFixed(4) : "",
      grades?.[r.pair_id] != null ? String(grades[r.pair_id]) : "",
      flag ? flag.reasons.join("; ") : "",
      flag?.notes ?? "",
      rowStatus(r),
      r.error ?? "",
      r.format_warning ?? "",
      overrides?.[r.pair_id]?.note ?? "",
    ];
  });

  return [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// CSV export — head-to-head sentence comparison
// ---------------------------------------------------------------------------

export interface HeadToHeadRow {
  pairId: string;
  a: SentenceMetrics;
  b: SentenceMetrics;
}

/**
 * Export the sentences compared on the Compare page with both models' exact
 * outputs, their per-sentence scores, and the reviewer's preference.
 */
export function exportHeadToHeadCSV(
  rows: HeadToHeadRow[],
  modelA: string,
  modelB: string,
  judgments?: Record<string, HeadToHeadJudgment>,
): string {
  const headers = [
    "pair_id", "source", "source_text", "reference_translation",
    "model_a", "translation_a", "meteor_a", "bertscore_a", "status_a",
    "model_b", "translation_b", "meteor_b", "bertscore_b", "status_b",
    "meteor_difference", "reviewer_preference", "reviewer_note",
  ];
  const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(4) : "");
  const out = rows.map(({ pairId, a, b }) => {
    const j = judgments?.[pairId];
    const diff = a.meteor != null && b.meteor != null ? (a.meteor - b.meteor).toFixed(4) : "";
    return [
      pairId, a.source, a.source_text || a.spanish_source, a.english_reference,
      modelA, a.llm_english_translation, fmt(a.meteor), fmt(a.bertscore_f1), classifyRow(a).key,
      modelB, b.llm_english_translation, fmt(b.meteor), fmt(b.bertscore_f1), classifyRow(b).key,
      diff,
      j ? (j.preferred === "tie" ? "tie" : j.preferred) : "",
      j?.note ?? "",
    ];
  });
  return toCSVString(headers, out);
}

// ---------------------------------------------------------------------------
// Browser file download
// ---------------------------------------------------------------------------

export function downloadFile(content: string, filename: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
