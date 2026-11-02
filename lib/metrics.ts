/**
 * Metric utilities for MedTranslate.
 *
 * All metric COMPUTATION now happens server-side in the Python backend.
 * This module only provides display helpers used by the frontend.
 */

/**
 * Compute summary statistics for an array of numbers (display only).
 */
export function summarizeMetric(values: number[]): {
  mean: number;
  std: number;
  min: number;
  max: number;
} {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean,
    std: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// ---------------------------------------------------------------------------
// Row classification (shared by Translate, Review, Metrics, Compare)
// ---------------------------------------------------------------------------

import type { SentenceMetrics, RefusalOverride } from "./types";

/** Scored rows below this count get a small-sample caution in the UI. */
export const SMALL_SAMPLE_THRESHOLD = 50;

/** Default METEOR threshold below which a pair is sent to physician review. */
export const DEFAULT_REVIEW_THRESHOLD = 0.4;

/** The model returned a translation and nothing went wrong. */
export function isCompleted(s: SentenceMetrics): boolean {
  return !!s.llm_english_translation && !s.error;
}

/** The model declined or returned nothing. Scored as 0. */
export function isRefused(s: SentenceMetrics): boolean {
  return s.error_kind === "refusal";
}

/** A refusal a reviewer marked legitimate. Excluded from every score. */
export function isExcluded(s: SentenceMetrics): boolean {
  return s.error_kind === "excluded";
}

/**
 * The provider or configuration failed. Unscored and retryable. Rows from
 * older backends that carry an error but no kind are treated as incomplete.
 */
export function isIncomplete(s: SentenceMetrics): boolean {
  return !!s.error && s.error_kind !== "refusal" && s.error_kind !== "excluded";
}

/**
 * Apply reviewer refusal overrides to a result set: refused rows whose
 * pair_id has an override become "excluded" (no score). Pure; returns a new
 * array only if something changed.
 */
export function applyRefusalOverrides(
  sentences: SentenceMetrics[],
  overrides: Record<string, RefusalOverride> | undefined,
): SentenceMetrics[] {
  if (!overrides || Object.keys(overrides).length === 0) return sentences;
  let changed = false;
  const out = sentences.map((s) => {
    if (isRefused(s) && overrides[s.pair_id]) {
      changed = true;
      return { ...s, error_kind: "excluded" as const, meteor: null, bertscore_f1: null };
    }
    return s;
  });
  return changed ? out : sentences;
}

/** Rows that carry a score: completed translations plus refusals (scored 0). */
export function isScored(s: SentenceMetrics): boolean {
  return (isCompleted(s) || isRefused(s)) && s.meteor != null;
}

export interface RunCounts {
  total: number;
  completed: number;
  refused: number;
  excluded: number;
  incomplete: number;
  pending: number;
  scored: number;
  formatWarnings: number;
}

export function countRun(sentences: SentenceMetrics[]): RunCounts {
  const c: RunCounts = { total: sentences.length, completed: 0, refused: 0, excluded: 0, incomplete: 0, pending: 0, scored: 0, formatWarnings: 0 };
  for (const s of sentences) {
    if (isCompleted(s)) c.completed += 1;
    else if (isRefused(s)) c.refused += 1;
    else if (isExcluded(s)) c.excluded += 1;
    else if (isIncomplete(s)) c.incomplete += 1;
    else c.pending += 1;
    if (isScored(s)) c.scored += 1;
    if (s.format_warning) c.formatWarnings += 1;
  }
  return c;
}

/** Group failed rows by error message, most frequent first. */
export function failureReasons(sentences: SentenceMetrics[]): { reason: string; kind: string; count: number }[] {
  const map = new Map<string, { reason: string; kind: string; count: number }>();
  for (const s of sentences) {
    if (!s.error) continue;
    const kind = isRefused(s) ? "refusal" : isExcluded(s) ? "excluded" : "infrastructure";
    const key = `${kind}|${s.error}`;
    const entry = map.get(key) ?? { reason: s.error, kind, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Score bands (match the plain-language guide in components/MetricGuide.tsx)
// ---------------------------------------------------------------------------

export type Tone = "success" | "warning" | "danger" | "muted";

export interface ScoreBand {
  label: string;
  /** Design-system tone used for the badge. */
  tone: Tone;
}

export type RowStatusKey = "completed" | "refused" | "excluded" | "incomplete" | "pending";

/** One place that decides how a row's state is named and coloured. */
export function rowStatus(s: SentenceMetrics): { key: RowStatusKey; label: string; tone: Tone } {
  if (isRefused(s)) return { key: "refused", label: "Refused", tone: "danger" };
  if (isExcluded(s)) return { key: "excluded", label: "Excluded", tone: "muted" };
  if (isIncomplete(s)) return { key: "incomplete", label: "Incomplete", tone: "warning" };
  if (s.llm_english_translation) return { key: "completed", label: "Complete", tone: "success" };
  return { key: "pending", label: "Pending", tone: "muted" };
}

/** Corpus BLEU (0–100): under 20 low overlap, 20–40 moderate, over 40 close to the reference wording. */
export function bleuBand(score: number): ScoreBand {
  if (score >= 40) return { label: "High overlap", tone: "success" };
  if (score >= 20) return { label: "Moderate", tone: "warning" };
  return { label: "Low overlap", tone: "danger" };
}

/** Mean METEOR (0–1): under 0.4 flagged, 0.4–0.6 fair, 0.6–0.75 good, over 0.75 strong. */
export function meteorBand(mean: number): ScoreBand {
  if (mean >= 0.75) return { label: "Strong", tone: "success" };
  if (mean >= 0.6) return { label: "Good", tone: "success" };
  if (mean >= 0.4) return { label: "Fair", tone: "warning" };
  return { label: "Below review threshold", tone: "danger" };
}

export function bandStyle(tone: Tone): { background: string; color: string; border: string } {
  if (tone === "muted") {
    return { background: "var(--bg-inset)", color: "var(--text-muted)", border: "1px solid var(--border)" };
  }
  return {
    background: `var(--${tone}-light)`,
    color: `var(--${tone})`,
    border: `1px solid var(--${tone}-border)`,
  };
}
