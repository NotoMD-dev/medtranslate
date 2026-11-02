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

import type { SentenceMetrics } from "./types";

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

/**
 * The provider or configuration failed. Unscored and retryable. Rows from
 * older backends that carry an error but no kind are treated as incomplete.
 */
export function isIncomplete(s: SentenceMetrics): boolean {
  return !!s.error && s.error_kind !== "refusal";
}

/** Rows that carry a score: completed translations plus refusals (scored 0). */
export function isScored(s: SentenceMetrics): boolean {
  return (isCompleted(s) || isRefused(s)) && s.meteor != null;
}

export interface RunCounts {
  total: number;
  completed: number;
  refused: number;
  incomplete: number;
  pending: number;
  scored: number;
  formatWarnings: number;
}

export function countRun(sentences: SentenceMetrics[]): RunCounts {
  const completed = sentences.filter(isCompleted).length;
  const refused = sentences.filter(isRefused).length;
  const incomplete = sentences.filter(isIncomplete).length;
  return {
    total: sentences.length,
    completed,
    refused,
    incomplete,
    pending: sentences.length - completed - refused - incomplete,
    scored: sentences.filter(isScored).length,
    formatWarnings: sentences.filter((s) => !!s.format_warning).length,
  };
}

/** Group failed rows by error message, most frequent first. */
export function failureReasons(sentences: SentenceMetrics[]): { reason: string; kind: string; count: number }[] {
  const map = new Map<string, { reason: string; kind: string; count: number }>();
  for (const s of sentences) {
    if (!s.error) continue;
    const kind = isRefused(s) ? "refusal" : "infrastructure";
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

export interface ScoreBand {
  label: string;
  /** Design-system tone used for the badge. */
  tone: "success" | "warning" | "danger";
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

export function bandStyle(tone: ScoreBand["tone"]): { background: string; color: string; border: string } {
  return {
    background: `var(--${tone}-light)`,
    color: `var(--${tone})`,
    border: `1px solid var(--${tone}-border)`,
  };
}
