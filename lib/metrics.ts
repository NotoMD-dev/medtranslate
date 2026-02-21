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
