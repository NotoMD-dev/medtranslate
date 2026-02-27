"use client";

import { useState, useEffect, useMemo } from "react";
import { MODEL_OPTIONS } from "@/lib/types";
import { summarizeMetric } from "@/lib/metrics";
import type { JobResults } from "@/lib/types";
import { getSessionComparisonResults } from "@/lib/session";

interface ModelSummary {
  modelId: string;
  label: string;
  bleu: number | null;
  meteorMean: number | null;
  meteorStd: number | null;
  bertMean: number | null;
  bertStd: number | null;
  totalPairs: number;
  completedPairs: number;
}

function getModelLabel(modelId: string): string {
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.label || modelId;
}

function summarize(results: JobResults): ModelSummary {
  const sentences = results.sentence_metrics ?? [];
  const completed = sentences.filter((s) => s.llm_english_translation && !s.error);
  const meteorVals = completed.map((s) => s.meteor).filter((v): v is number => v != null);
  const bertVals = completed.map((s) => s.bertscore_f1).filter((v): v is number => v != null);
  const meteorStats = summarizeMetric(meteorVals);
  const bertStats = summarizeMetric(bertVals);

  return {
    modelId: results.translation_config?.model || "unknown",
    label: getModelLabel(results.translation_config?.model || "unknown"),
    bleu: results.corpus_metrics?.overall.bleu_score ?? null,
    meteorMean: meteorVals.length > 0 ? meteorStats.mean : null,
    meteorStd: meteorVals.length > 0 ? meteorStats.std : null,
    bertMean: bertVals.length > 0 ? bertStats.mean : null,
    bertStd: bertVals.length > 0 ? bertStats.std : null,
    totalPairs: sentences.length,
    completedPairs: completed.length,
  };
}

function winnerBadge(val: "A" | "B" | "tie") {
  const colors = {
    A: { bg: "var(--accent-soft)", color: "var(--accent-text)", border: "var(--accent)" },
    B: { bg: "#F3E8FF", color: "#7C3AED", border: "#C4B5FD" },
    tie: { bg: "var(--bg-inset)", color: "var(--text-muted)", border: "var(--border)" },
  };
  const c = colors[val];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {val === "tie" ? "Tie" : `Model ${val}`}
    </span>
  );
}

export default function ComparePage() {
  const [comparisonData, setComparisonData] = useState<Record<string, JobResults>>({});
  const [modelA, setModelA] = useState<string>("");
  const [modelB, setModelB] = useState<string>("");

  useEffect(() => {
    const saved = getSessionComparisonResults();
    if (saved) {
      setComparisonData(saved);
      const keys = Object.keys(saved);
      if (keys.length >= 1) setModelA(keys[0]);
      if (keys.length >= 2) setModelB(keys[1]);
    }
  }, []);

  const availableModels = Object.keys(comparisonData);

  const summaryA = useMemo(
    () => (modelA && comparisonData[modelA] ? summarize(comparisonData[modelA]) : null),
    [modelA, comparisonData]
  );
  const summaryB = useMemo(
    () => (modelB && comparisonData[modelB] ? summarize(comparisonData[modelB]) : null),
    [modelB, comparisonData]
  );

  // Determine winners per metric (higher is better)
  function getWinner(a: number | null, b: number | null): "A" | "B" | "tie" {
    if (a == null && b == null) return "tie";
    if (a == null) return "B";
    if (b == null) return "A";
    if (Math.abs(a - b) < 0.001) return "tie";
    return a > b ? "A" : "B";
  }

  const metrics = summaryA && summaryB ? [
    {
      name: "SacreBLEU",
      desc: "Corpus-level n-gram precision (sacrebleu)",
      valA: summaryA.bleu,
      valB: summaryB.bleu,
      format: (v: number | null) => v != null ? v.toFixed(2) : "--",
      winner: getWinner(summaryA.bleu, summaryB.bleu),
    },
    {
      name: "METEOR",
      desc: "WordNet + stemming alignment (NLTK)",
      valA: summaryA.meteorMean,
      valB: summaryB.meteorMean,
      format: (v: number | null) => v != null ? v.toFixed(3) : "--",
      stdA: summaryA.meteorStd,
      stdB: summaryB.meteorStd,
      winner: getWinner(summaryA.meteorMean, summaryB.meteorMean),
    },
    {
      name: "BERTScore F1",
      desc: "Semantic similarity (roberta-base, rescaled)",
      valA: summaryA.bertMean,
      valB: summaryB.bertMean,
      format: (v: number | null) => v != null ? v.toFixed(3) : "--",
      stdA: summaryA.bertStd,
      stdB: summaryB.bertStd,
      winner: getWinner(summaryA.bertMean, summaryB.bertMean),
    },
  ] : [];

  // Count wins
  const winsA = metrics.filter((m) => m.winner === "A").length;
  const winsB = metrics.filter((m) => m.winner === "B").length;

  return (
    <div className="page-container">

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          Head-to-Head Comparison
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          Compare translation quality metrics between two model runs.
        </p>
      </div>

      {availableModels.length < 2 ? (
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 48, textAlign: "center", boxShadow: "var(--shadow)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 18, marginBottom: 8 }}>
            Need at least 2 model runs
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 480, margin: "0 auto" }}>
            Run translations with different models on the Translate page. Each completed run is saved for comparison.
            You have <strong>{availableModels.length}</strong> model run{availableModels.length !== 1 ? "s" : ""} so far
            {availableModels.length > 0 && `: ${availableModels.map(getModelLabel).join(", ")}`}.
          </p>
        </div>
      ) : (
        <>
          {/* Model selectors */}
          <div className="anim d1" style={{ marginBottom: 32, display: "flex", gap: 24 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                Model A
              </div>
              <select
                value={modelA}
                onChange={(e) => setModelA(e.target.value)}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: "var(--radius-sm)",
                  border: "1.5px solid var(--accent)", background: "var(--accent-soft)",
                  color: "var(--accent-text)", fontSize: 15, fontWeight: 600,
                  fontFamily: "var(--font)", cursor: "pointer",
                }}
              >
                {availableModels.map((id) => (
                  <option key={id} value={id}>{getModelLabel(id)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 12, fontSize: 18, color: "var(--text-muted)", fontWeight: 700 }}>
              vs
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                Model B
              </div>
              <select
                value={modelB}
                onChange={(e) => setModelB(e.target.value)}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: "var(--radius-sm)",
                  border: "1.5px solid #C4B5FD", background: "#F3E8FF",
                  color: "#7C3AED", fontSize: 15, fontWeight: 600,
                  fontFamily: "var(--font)", cursor: "pointer",
                }}
              >
                {availableModels.map((id) => (
                  <option key={id} value={id}>{getModelLabel(id)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Overall winner banner */}
          {summaryA && summaryB && (
            <div className="anim d2" style={{
              marginBottom: 32, background: "var(--bg-surface)", borderRadius: "var(--radius)",
              padding: 24, boxShadow: "var(--shadow)", textAlign: "center",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                Overall Winner
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                {winsA > winsB
                  ? summaryA.label
                  : winsB > winsA
                  ? summaryB.label
                  : "Tie"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {summaryA.label}: {winsA} win{winsA !== 1 ? "s" : ""} &middot;{" "}
                {summaryB.label}: {winsB} win{winsB !== 1 ? "s" : ""} &middot;{" "}
                {metrics.filter((m) => m.winner === "tie").length} tie{metrics.filter((m) => m.winner === "tie").length !== 1 ? "s" : ""}
              </div>
            </div>
          )}

          {/* Comparison table */}
          {summaryA && summaryB && (
            <div className="anim d3" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", overflow: "hidden", marginBottom: 48 }}>
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "center" }}>
                      <span style={{ color: "var(--accent-text)" }}>{summaryA.label}</span>
                    </th>
                    <th style={{ textAlign: "center" }}>
                      <span style={{ color: "#7C3AED" }}>{summaryB.label}</span>
                    </th>
                    <th style={{ textAlign: "center" }}>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.name}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.desc}</div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: m.winner === "A" ? "var(--accent-text)" : "var(--text-primary)" }}>
                          {m.format(m.valA)}
                        </div>
                        {"stdA" in m && m.stdA != null && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>&plusmn; {m.stdA.toFixed(3)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: m.winner === "B" ? "#7C3AED" : "var(--text-primary)" }}>
                          {m.format(m.valB)}
                        </div>
                        {"stdB" in m && m.stdB != null && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>&plusmn; {m.stdB.toFixed(3)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>{winnerBadge(m.winner)}</td>
                    </tr>
                  ))}
                  {/* Summary row */}
                  <tr>
                    <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-muted)" }}>
                      Completed Pairs
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                      {summaryA.completedPairs} / {summaryA.totalPairs}
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                      {summaryB.completedPairs} / {summaryB.totalPairs}
                    </td>
                    <td style={{ background: "var(--bg-inset)" }} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Per-sentence comparison (top differences) */}
          {summaryA && summaryB && modelA && modelB && (
            <SentenceDiffs
              resultsA={comparisonData[modelA]}
              resultsB={comparisonData[modelB]}
              labelA={summaryA.label}
              labelB={summaryB.label}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: show sentences with biggest METEOR score differences
// ---------------------------------------------------------------------------

function SentenceDiffs({
  resultsA,
  resultsB,
  labelA,
  labelB,
}: {
  resultsA: JobResults;
  resultsB: JobResults;
  labelA: string;
  labelB: string;
}) {
  const diffs = useMemo(() => {
    const mapA = new Map(resultsA.sentence_metrics.map((s) => [s.pair_id, s]));
    const mapB = new Map(resultsB.sentence_metrics.map((s) => [s.pair_id, s]));

    const pairs: { pairId: string; meteorA: number; meteorB: number; diff: number }[] = [];
    for (const [pairId, sA] of mapA) {
      const sB = mapB.get(pairId);
      if (sB && sA.meteor != null && sB.meteor != null) {
        pairs.push({
          pairId,
          meteorA: sA.meteor,
          meteorB: sB.meteor,
          diff: Math.abs(sA.meteor - sB.meteor),
        });
      }
    }

    return pairs.sort((a, b) => b.diff - a.diff).slice(0, 10);
  }, [resultsA, resultsB]);

  if (diffs.length === 0) return null;

  return (
    <div className="anim d4" style={{ marginBottom: 48 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        Largest METEOR Score Differences
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>Pair ID</th>
              <th style={{ textAlign: "center" }}>{labelA} METEOR</th>
              <th style={{ textAlign: "center" }}>{labelB} METEOR</th>
              <th style={{ textAlign: "center" }}>Difference</th>
              <th style={{ textAlign: "center" }}>Better</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.pairId}>
                <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{d.pairId}</td>
                <td style={{ textAlign: "center", fontWeight: 600, color: d.meteorA > d.meteorB ? "var(--accent-text)" : "var(--text-primary)" }}>
                  {d.meteorA.toFixed(3)}
                </td>
                <td style={{ textAlign: "center", fontWeight: 600, color: d.meteorB > d.meteorA ? "#7C3AED" : "var(--text-primary)" }}>
                  {d.meteorB.toFixed(3)}
                </td>
                <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                  {d.diff.toFixed(3)}
                </td>
                <td style={{ textAlign: "center" }}>
                  {d.meteorA > d.meteorB
                    ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-text)" }}>{labelA}</span>
                    : d.meteorB > d.meteorA
                    ? <span style={{ fontSize: 11, fontWeight: 600, color: "#7C3AED" }}>{labelB}</span>
                    : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Tie</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
