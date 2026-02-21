/**
 * Client-side translation metrics for MedTranslate.
 *
 * BLEU and METEOR are standard implementations.
 * BERTProxy is an n-gram cosine similarity approximation; for publication,
 * use the Python bert_score library via scripts/metrics/compute_all.py.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function nGrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

function countMap(items: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return map;
}

/**
 * BLEU score (1-4 gram) with brevity penalty and smoothing.
 * Uses method1 smoothing (add epsilon to zero counts) to match the
 * Python NLTK SmoothingFunction().method1 used in compute_all.py.
 */
export function computeBLEU(candidate: string, reference: string): number {
  const cToks = tokenize(candidate);
  const rToks = tokenize(reference);
  if (cToks.length === 0 || rToks.length === 0) return 0;

  const epsilon = 0.1;
  let logScore = 0;
  let count = 0;

  for (let n = 1; n <= Math.min(4, cToks.length); n++) {
    const cGrams = nGrams(cToks, n);
    const rGrams = nGrams(rToks, n);
    if (cGrams.length === 0) continue;

    const rCounts = countMap(rGrams);
    const cCounts = countMap(cGrams);

    let clipped = 0;
    for (const [gram, c] of cCounts) {
      clipped += Math.min(c, rCounts.get(gram) || 0);
    }

    // Method1 smoothing: add epsilon when clipped count is zero
    const precision =
      clipped === 0
        ? epsilon / cGrams.length
        : clipped / cGrams.length;

    logScore += Math.log(precision);
    count++;
  }

  if (count === 0) return 0;

  // Brevity penalty
  const bp =
    cToks.length >= rToks.length
      ? 1
      : Math.exp(1 - rToks.length / cToks.length);

  return bp * Math.exp(logScore / count);
}

/**
 * METEOR score with unigram matching, fragmentation penalty.
 * Simplified version (no synonym/stem matching; use Python for full METEOR).
 */
export function computeMETEOR(candidate: string, reference: string): number {
  const cToks = tokenize(candidate);
  const rToks = tokenize(reference);
  if (cToks.length === 0 || rToks.length === 0) return 0;

  // Count unigram matches
  const rAvailable = countMap(rToks);
  let matches = 0;
  for (const tok of cToks) {
    const avail = rAvailable.get(tok) || 0;
    if (avail > 0) {
      matches++;
      rAvailable.set(tok, avail - 1);
    }
  }

  if (matches === 0) return 0;

  const P = matches / cToks.length;
  const R = matches / rToks.length;
  const F = (10 * P * R) / (9 * P + R);

  // Fragmentation penalty: count chunks of contiguous matches
  let chunks = 0;
  let inChunk = false;
  const rSet = new Set(rToks);
  for (const tok of cToks) {
    if (rSet.has(tok)) {
      if (!inChunk) {
        chunks++;
        inChunk = true;
      }
    } else {
      inChunk = false;
    }
  }

  const penalty = 0.5 * Math.pow(chunks / matches, 3);
  return F * (1 - penalty);
}

/**
 * BERTProxy: cosine similarity over n-gram frequency vectors.
 *
 * This is NOT BERTScore. It approximates semantic similarity using
 * unigram + bigram + trigram overlap. For publication-quality results,
 * use the Python bert_score library.
 */
export function computeBERTProxy(candidate: string, reference: string): number {
  const cToks = tokenize(candidate);
  const rToks = tokenize(reference);
  if (cToks.length === 0 || rToks.length === 0) return 0;

  // Build combined n-gram feature vectors
  const allC = [
    ...cToks,
    ...nGrams(cToks, 2),
    ...nGrams(cToks, 3),
  ];
  const allR = [
    ...rToks,
    ...nGrams(rToks, 2),
    ...nGrams(rToks, 3),
  ];

  const vocab = new Set([...allC, ...allR]);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const w of vocab) {
    const va = allC.filter((t) => t === w).length;
    const vb = allR.filter((t) => t === w).length;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

/**
 * Compute all three metrics for a candidate/reference pair.
 */
export function computeAllMetrics(
  candidate: string,
  reference: string
): { bleu: number; meteor: number; bert_proxy: number } {
  return {
    bleu: computeBLEU(candidate, reference),
    meteor: computeMETEOR(candidate, reference),
    bert_proxy: computeBERTProxy(candidate, reference),
  };
}

/**
 * Compute summary statistics for an array of numbers.
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
