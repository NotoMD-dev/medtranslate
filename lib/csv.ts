import type { TranslationPair, TranslationResult } from "./types";

/**
 * Parse a CSV string into TranslationPair objects.
 * Handles quoted fields with commas and newlines.
 */
export function parseCSV(text: string): TranslationPair[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);

  // Validate required columns
  const required = ["spanish_source"];
  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required column: "${col}". Found: ${headers.join(", ")}`);
    }
  }

  const rows: TranslationPair[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || "";
    });

    rows.push({
      pair_id: obj.pair_id || `row_${i}`,
      source: (obj.source as TranslationPair["source"]) || "ClinSpEn_ClinicalCases",
      content_type: (obj.content_type as TranslationPair["content_type"]) || "clinical_case_report",
      english_reference: obj.english_reference || "",
      spanish_source: obj.spanish_source || "",
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
 * Export TranslationResult array to CSV string.
 */
export function exportResultsCSV(results: TranslationResult[]): string {
  const headers = [
    "pair_id",
    "source",
    "content_type",
    "english_reference",
    "spanish_source",
    "llm_english_translation",
    "bleu_score",
    "meteor_score",
    "bert_proxy_score",
    "clinical_significance_grade",
  ];

  const escape = (v: string | number | null | undefined): string => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = results.map((r) =>
    [
      r.pair_id,
      r.source,
      r.content_type,
      r.english_reference,
      r.spanish_source,
      r.llm_english_translation,
      r._bleu != null ? r._bleu.toFixed(4) : "",
      r._meteor != null ? r._meteor.toFixed(4) : "",
      r._bert_proxy != null ? r._bert_proxy.toFixed(4) : "",
      r._clinical_grade != null ? r._clinical_grade : "",
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
