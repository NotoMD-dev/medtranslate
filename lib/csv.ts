import type { TranslationPair, SentenceMetrics, ClinicalGrade, ReferenceFlag } from "./types";
import { SOURCE_LANGUAGES } from "./types";

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

/**
 * Detect which source language column exists in the headers.
 * Returns the matching column name, or null if none found.
 */
export function detectSourceColumn(headers: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const lang of SOURCE_LANGUAGES) {
    if (lower.includes(lang.columnName)) return lang.columnName;
  }
  if (lower.includes("source_text")) return "source_text";
  return null;
}

/**
 * Parse a CSV string into TranslationPair objects.
 * Handles quoted fields with commas and newlines.
 */
export function parseCSV(text: string, sourceColumn?: string): TranslationPair[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const srcCol = sourceColumn || detectSourceColumn(headers) || "spanish_source";

  const required = [srcCol, "english_reference"];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.map((c) => `"${c}"`).join(", ")}. Found: ${headers.join(", ")}`,
    );
  }

  const rows: TranslationPair[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ""; });

    const sourceText = obj[srcCol] || "";
    rows.push({
      pair_id: obj.pair_id || `row_${i}`,
      source: obj.source || "ClinSpEn_ClinicalCases",
      content_type: obj.content_type || "clinical_case_report",
      english_reference: obj.english_reference || "",
      source_text: sourceText,
      spanish_source: sourceText,
      llm_english_translation: obj.llm_english_translation || "",
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

const SUBMISSION_HEADERS = [
  "pair_id", "source", "content_type", "english_reference",
  "source_text", "spanish_source", "llm_english_translation",
];

function toSubmissionRow(
  pairId: string, source: string, contentType: string,
  englishRef: string, sourceText: string, translation: string,
): string[] {
  return [pairId, source, contentType, englishRef, sourceText, sourceText, translation];
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

/** Convert SentenceMetrics[] to a CSV File for re-submission in metrics-only mode. */
export function sentenceMetricsToCSVFile(sentences: SentenceMetrics[], filename = "dataset.csv"): File {
  const rows = sentences.map((r) =>
    toSubmissionRow(
      r.pair_id, r.source, r.content_type,
      r.english_reference, r.source_text || r.spanish_source, r.llm_english_translation,
    ),
  );
  return new File([toCSVString(SUBMISSION_HEADERS, rows)], filename, { type: "text/csv" });
}

// ---------------------------------------------------------------------------
// CSV export — results download
// ---------------------------------------------------------------------------

/** Export sentence metrics results to CSV string for the user to download. */
export function exportResultsCSV(
  sentences: SentenceMetrics[],
  grades?: Record<string, ClinicalGrade>,
  refFlags?: Record<string, ReferenceFlag>,
): string {
  const headers = [
    "pair_id", "source", "content_type", "english_reference", "source_text",
    "llm_english_translation", "meteor_score", "bertscore_f1",
    "clinical_significance_grade", "reference_flag_issues", "reference_flag_notes", "error",
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
      r.error ?? "",
    ];
  });

  return [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
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
