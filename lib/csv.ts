import type { TranslationPair, SentenceMetrics, ClinicalGrade } from "./types";
import { SOURCE_LANGUAGES } from "./types";

/**
 * Detect which source language column exists in the headers.
 * Returns the matching column name, or null if none found.
 */
export function detectSourceColumn(headers: string[]): string | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const lang of SOURCE_LANGUAGES) {
    if (lowerHeaders.includes(lang.columnName)) return lang.columnName;
  }
  // Fallback: check for generic "source_text"
  if (lowerHeaders.includes("source_text")) return "source_text";
  return null;
}

/**
 * Parse a CSV string into TranslationPair objects.
 * Handles quoted fields with commas and newlines.
 * Supports dynamic source language columns (e.g. french_source, korean_source).
 */
export function parseCSV(text: string, sourceColumn?: string): TranslationPair[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);

  // Determine source text column
  const srcCol = sourceColumn || detectSourceColumn(headers) || "spanish_source";

  // Validate required columns
  const required = [srcCol, "english_reference"];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.map((c) => `"${c}"`).join(", ")}. Found: ${headers.join(", ")}`
    );
  }

  const rows: TranslationPair[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || "";
    });

    const sourceText = obj[srcCol] || "";
    rows.push({
      pair_id: obj.pair_id || `row_${i}`,
      source: obj.source || "ClinSpEn_ClinicalCases",
      content_type: obj.content_type || "clinical_case_report",
      english_reference: obj.english_reference || "",
      source_text: sourceText,
      spanish_source: sourceText, // backward compat
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

/**
 * Convert TranslationPair[] to a CSV File suitable for backend upload.
 * Uses source_text column (the backend understands this generic column).
 */
export function pairsToCSVFile(
  pairs: TranslationPair[],
  filename: string = "dataset.csv",
): File {
  const headers = [
    "pair_id",
    "source",
    "content_type",
    "english_reference",
    "source_text",
    "llm_english_translation",
  ];

  const escape = (v: string): string => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const csvRows = pairs.map((r) =>
    [
      r.pair_id,
      r.source,
      r.content_type,
      r.english_reference,
      r.source_text || r.spanish_source,
      r.llm_english_translation,
    ]
      .map(escape)
      .join(",")
  );

  const csvContent = [headers.join(","), ...csvRows].join("\n");
  return new File([csvContent], filename, { type: "text/csv" });
}

/**
 * Export sentence metrics results to CSV string.
 */
export function exportResultsCSV(
  sentences: SentenceMetrics[],
  grades?: Record<string, ClinicalGrade>,
): string {
  const headers = [
    "pair_id",
    "source",
    "content_type",
    "english_reference",
    "source_text",
    "llm_english_translation",
    "meteor_score",
    "bertscore_f1",
    "clinical_significance_grade",
    "error",
  ];

  const escape = (v: string | number | null | undefined): string => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = sentences.map((r) =>
    [
      r.pair_id,
      r.source,
      r.content_type,
      r.english_reference,
      r.source_text || r.spanish_source,
      r.llm_english_translation,
      r.meteor != null ? r.meteor.toFixed(4) : "",
      r.bertscore_f1 != null ? r.bertscore_f1.toFixed(4) : "",
      grades?.[r.pair_id] != null ? grades[r.pair_id] : "",
      r.error ?? "",
    ]
      .map(escape)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Trigger a file download in the browser.
 */
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
