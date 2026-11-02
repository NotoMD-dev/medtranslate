"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import MetricGuideLink from "@/components/MetricGuide";
import { MODEL_OPTIONS, modelLabel, languageLabel, targetLanguageOf, sourceLanguageOf, bertscoreModelFor } from "@/lib/types";
import { summarizeMetric, countRun, isScored, applyRefusalOverrides, rowStatus, bandStyle, explainRefusal, splitRefusalError, SMALL_SAMPLE_THRESHOLD } from "@/lib/metrics";
import { exportHeadToHeadCSV, downloadFile } from "@/lib/csv";
import type { JobResults, RefusalOverride, HeadToHeadJudgment, SentenceMetrics } from "@/lib/types";
import {
  getSessionComparisonResultsAsync,
  getSessionRefusalOverrides,
  getSessionHeadToHeadJudgments,
  setSessionHeadToHeadJudgments,
} from "@/lib/session";

interface ModelSummary {
  modelId: string;
  label: string;
  effort: string | null;
  systemPrompt: string | null;
  bleu: number | null;
  meteorMean: number | null;
  meteorStd: number | null;
  bertMean: number | null;
  bertStd: number | null;
  totalPairs: number;
  completedPairs: number;
  refusedPairs: number;
  excludedPairs: number;
  incompletePairs: number;
  scoredPairs: number;
}

function getModelLabel(modelId: string): string {
  return modelLabel(modelId);
}

function summarize(results: JobResults, overrides: Record<string, RefusalOverride>): ModelSummary {
  // Reviewer overrides are a property of the source sentence, so they apply
  // to both runs alike.
  const sentences = applyRefusalOverrides(results.sentence_metrics ?? [], overrides);
  const counts = countRun(sentences);
  // Scored rows = completed translations + refusals (scored 0). Incomplete
  // rows (provider/config failures) carry no score.
  const scored = sentences.filter(isScored);
  const meteorVals = scored.map((s) => s.meteor).filter((v): v is number => v != null);
  const bertVals = scored.map((s) => s.bertscore_f1).filter((v): v is number => v != null);
  const meteorStats = summarizeMetric(meteorVals);
  const bertStats = summarizeMetric(bertVals);

  return {
    modelId: results.translation_config?.model || "unknown",
    label: getModelLabel(results.translation_config?.model || "unknown"),
    effort: results.translation_config?.reasoning_effort ?? null,
    systemPrompt: results.translation_config?.system_prompt ?? null,
    bleu: results.corpus_metrics?.overall.bleu_score ?? null,
    meteorMean: meteorVals.length > 0 ? meteorStats.mean : null,
    meteorStd: meteorVals.length > 0 ? meteorStats.std : null,
    bertMean: bertVals.length > 0 ? bertStats.mean : null,
    bertStd: bertVals.length > 0 ? bertStats.std : null,
    totalPairs: sentences.length,
    completedPairs: counts.completed,
    refusedPairs: counts.refused,
    excludedPairs: counts.excluded,
    incompletePairs: counts.incomplete,
    scoredPairs: scored.length,
  };
}

type Winner = "A" | "B" | "tie" | "none";

function winnerBadge(val: Winner) {
  const colors = {
    A: { bg: "var(--accent-soft)", color: "var(--accent-text)", border: "var(--accent)" },
    B: { bg: "#F3E8FF", color: "#7C3AED", border: "#C4B5FD" },
    tie: { bg: "var(--bg-inset)", color: "var(--text-muted)", border: "var(--border)" },
    none: { bg: "transparent", color: "var(--text-muted)", border: "var(--border-subtle)" },
  };
  const c = colors[val];
  const text = val === "tie" ? "Tie" : val === "none" ? "Not computed" : `Model ${val}`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {text}
    </span>
  );
}

export default function ComparePage() {
  const [comparisonData, setComparisonData] = useState<Record<string, JobResults>>({});
  const [modelA, setModelA] = useState<string>("");
  const [modelB, setModelB] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<string, RefusalOverride>>({});
  const [judgments, setJudgments] = useState<Record<string, HeadToHeadJudgment>>({});
  const router = useRouter();

  useEffect(() => {
    setOverrides(getSessionRefusalOverrides());
    setJudgments(getSessionHeadToHeadJudgments());
    getSessionComparisonResultsAsync().then((saved) => {
      if (!saved) return;
      setComparisonData(saved);
      const keys = Object.keys(saved);
      if (keys.length >= 1) setModelA(keys[0]);
      if (keys.length >= 2) setModelB(keys[1]);
    });
  }, []);

  const availableModels = Object.keys(comparisonData);
  // Models offered in the app that have no saved run yet: one click starts a
  // run of the same dataset and prompt with that model on the Translate page.
  const missingModels = MODEL_OPTIONS.filter((m) => !availableModels.includes(m.id));
  const startRunWith = (modelId: string) =>
    router.push(`/translate?model=${encodeURIComponent(modelId)}&autorun=1`);
  const runWithButton = (m: { id: string; label: string }) => (
    <button
      key={m.id}
      onClick={() => startRunWith(m.id)}
      style={{
        fontFamily: "var(--font)", fontSize: 14, fontWeight: 600, padding: "10px 20px",
        borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff",
        border: "none", cursor: "pointer",
      }}
    >
      Translate the same dataset with {m.label}
    </button>
  );

  const summaryA = useMemo(
    () => (modelA && comparisonData[modelA] ? summarize(comparisonData[modelA], overrides) : null),
    [modelA, comparisonData, overrides]
  );
  const summaryB = useMemo(
    () => (modelB && comparisonData[modelB] ? summarize(comparisonData[modelB], overrides) : null),
    [modelB, comparisonData, overrides]
  );

  // Determine winners per metric (higher is better). A metric missing from
  // both runs (e.g. BERTScore left off) is "none" and stays out of the tally.
  function getWinner(a: number | null, b: number | null): Winner {
    if (a == null && b == null) return "none";
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
      desc: `Semantic similarity (${bertscoreModelFor(targetLanguageOf(comparisonData[modelA]?.translation_config))}, rescaled)`,
      valA: summaryA.bertMean,
      valB: summaryB.bertMean,
      format: (v: number | null) => v != null ? v.toFixed(3) : "--",
      stdA: summaryA.bertStd,
      stdB: summaryB.bertStd,
      winner: getWinner(summaryA.bertMean, summaryB.bertMean),
    },
  ] : [];

  // Count wins (metrics not computed for either run are excluded)
  const winsA = metrics.filter((m) => m.winner === "A").length;
  const winsB = metrics.filter((m) => m.winner === "B").length;
  const ties = metrics.filter((m) => m.winner === "tie").length;
  const notComputed = metrics.filter((m) => m.winner === "none").map((m) => m.name);
  const promptMismatch =
    !!summaryA && !!summaryB && !!summaryA.systemPrompt && !!summaryB.systemPrompt &&
    summaryA.systemPrompt.trim() !== summaryB.systemPrompt.trim();
  const smallSample =
    !!summaryA && !!summaryB &&
    Math.min(summaryA.scoredPairs, summaryB.scoredPairs) < SMALL_SAMPLE_THRESHOLD;
  const directionOf = (id: string) => {
    const cfg = comparisonData[id]?.translation_config;
    return `${languageLabel(sourceLanguageOf(cfg))} \u2192 ${languageLabel(targetLanguageOf(cfg))}`;
  };
  const directionMismatch =
    !!modelA && !!modelB && !!comparisonData[modelA] && !!comparisonData[modelB] &&
    directionOf(modelA) !== directionOf(modelB);

  return (
    <div className="page-container">
      <Header />

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          Head-to-Head Comparison
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "0 0 10px" }}>
          Compare translation quality metrics between two model runs.
        </p>
        <MetricGuideLink />
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
          {availableModels.length === 1 && missingModels.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
                Compare against
              </div>
              <div className="button-row" style={{ justifyContent: "center", alignItems: "center" }}>
                <span
                  title="Already run on this dataset"
                  style={{ padding: "10px 20px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-inset)", color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}
                >
                  {getModelLabel(availableModels[0])} &middot; done
                </span>
                {missingModels.map(runWithButton)}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
                Starts the run on the Translate page with the same dataset and prompt. Come back here when it finishes.
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Model selectors */}
          <div className="anim d1 compare-selectors" style={{ marginBottom: 32 }}>
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
            <div className="compare-vs">vs</div>
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

          {missingModels.length > 0 && (
            <div className="anim d2" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13, color: "var(--text-muted)" }}>
              <span>Not run yet on this dataset:</span>
              {missingModels.map(runWithButton)}
            </div>
          )}

          {/* Fairness warnings */}
          {directionMismatch && summaryA && summaryB && (
            <div className="anim d2" style={{ marginBottom: 16, padding: 16, background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", fontSize: 13, lineHeight: 1.6 }}>
              <strong>These runs translated in different directions, so the comparison is not fair.</strong> {summaryA.label} ran {directionOf(modelA)} and {summaryB.label} ran {directionOf(modelB)}.
            </div>
          )}
          {promptMismatch && summaryA && summaryB && (
            <div className="anim d2" style={{ marginBottom: 16, padding: 16, background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", fontSize: 13, lineHeight: 1.6 }}>
              <strong>These runs used different system prompts, so the comparison is not fair.</strong> Re-run {summaryA.label} or {summaryB.label} with the current prompt before reading the winner.
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 12 }}>Show both prompts</summary>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                  <div style={{ marginBottom: 6 }}><strong style={{ color: "var(--accent-text)" }}>{summaryA.label}:</strong> {summaryA.systemPrompt}</div>
                  <div><strong style={{ color: "#7C3AED" }}>{summaryB.label}:</strong> {summaryB.systemPrompt}</div>
                </div>
              </details>
            </div>
          )}
          {smallSample && summaryA && summaryB && (
            <div className="anim d2" style={{ marginBottom: 16, padding: 14, background: "var(--warning-light)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-sm)", color: "var(--warning)", fontSize: 13, lineHeight: 1.6 }}>
              <strong>Small sample.</strong> {summaryA.label} has {summaryA.scoredPairs} scored rows and {summaryB.label} has {summaryB.scoredPairs}. Below {SMALL_SAMPLE_THRESHOLD}, corpus BLEU and the averages swing with every sentence; a difference smaller than the &plusmn; spread is not evidence.
            </div>
          )}

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
                {ties} tie{ties !== 1 ? "s" : ""}
              </div>
              {notComputed.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                  {notComputed.join(", ")} was not computed for these runs and is not counted. Enable &ldquo;Include BERTScore&rdquo; on the Translate page to add it.
                </div>
              )}
            </div>
          )}

          {/* Comparison table */}
          {summaryA && summaryB && (
            <div className="anim d3 table-scroll" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", marginBottom: 48 }}>
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "center" }}>
                      <span style={{ color: "var(--accent-text)" }}>{summaryA.label}</span>
                      {summaryA.effort && (
                        <span style={{ display: "block", fontSize: 10, fontWeight: 500, letterSpacing: 0, textTransform: "none", color: "var(--text-muted)" }}>effort: {summaryA.effort}</span>
                      )}
                    </th>
                    <th style={{ textAlign: "center" }}>
                      <span style={{ color: "#7C3AED" }}>{summaryB.label}</span>
                      {summaryB.effort && (
                        <span style={{ display: "block", fontSize: 10, fontWeight: 500, letterSpacing: 0, textTransform: "none", color: "var(--text-muted)" }}>effort: {summaryB.effort}</span>
                      )}
                    </th>
                    <th style={{ textAlign: "center" }}>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.name}>
                      <td className="wrap">
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
                  {/* Summary rows */}
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
                  <tr>
                    <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-muted)" }}>
                      <div>Refused (scored 0)</div>
                      <div style={{ fontSize: 11, fontWeight: 400 }}>Model declined or returned nothing</div>
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: summaryA.refusedPairs > 0 ? "var(--danger)" : "var(--text-primary)" }}>
                      {summaryA.refusedPairs}
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: summaryB.refusedPairs > 0 ? "var(--danger)" : "var(--text-primary)" }}>
                      {summaryB.refusedPairs}
                    </td>
                    <td style={{ background: "var(--bg-inset)" }} />
                  </tr>
                  {(summaryA.excludedPairs > 0 || summaryB.excludedPairs > 0) && (
                    <tr>
                      <td className="wrap" style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-muted)" }}>
                        <div>Excluded by reviewer</div>
                        <div style={{ fontSize: 11, fontWeight: 400 }}>Refusal judged legitimate; not scored</div>
                      </td>
                      <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{summaryA.excludedPairs}</td>
                      <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>{summaryB.excludedPairs}</td>
                      <td style={{ background: "var(--bg-inset)" }} />
                    </tr>
                  )}
                  <tr>
                    <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-muted)" }}>
                      <div>Incomplete (not scored)</div>
                      <div style={{ fontSize: 11, fontWeight: 400 }}>Provider or configuration failure; retry on Translate</div>
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: summaryA.incompletePairs > 0 ? "var(--warning)" : "var(--text-primary)" }}>
                      {summaryA.incompletePairs}
                    </td>
                    <td style={{ background: "var(--bg-inset)", textAlign: "center", fontWeight: 600, color: summaryB.incompletePairs > 0 ? "var(--warning)" : "var(--text-primary)" }}>
                      {summaryB.incompletePairs}
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
              modelA={modelA}
              modelB={modelB}
              labelA={summaryA.label}
              labelB={summaryB.label}
              overrides={overrides}
              judgments={judgments}
              onJudge={(pairId, preferred, note) => {
                setJudgments((prev) => {
                  const next = { ...prev, [pairId]: { preferred, note, models: [modelA, modelB] as [string, string], at: new Date().toISOString() } };
                  setSessionHeadToHeadJudgments(next);
                  return next;
                });
              }}
              onClearJudgment={(pairId) => {
                setJudgments((prev) => {
                  const { [pairId]: _, ...rest } = prev;
                  setSessionHeadToHeadJudgments(rest);
                  return rest;
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: sentences with the biggest METEOR score differences.
// Clicking a row opens both models' exact outputs side by side; the reviewer
// can record which translation is actually better.
// ---------------------------------------------------------------------------

const DIFF_LIMITS = [10, 25, 0] as const; // 0 = all

const navButtonStyle: React.CSSProperties = {
  fontFamily: "var(--font)", fontSize: 12, fontWeight: 600, padding: "6px 12px",
  borderRadius: "var(--radius-xs)", background: "var(--bg-surface)",
  color: "var(--text-secondary)", border: "1px solid var(--border)",
  display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1,
};

function OutputPanel({
  label,
  color,
  sentence,
}: {
  label: string;
  color: string;
  sentence: SentenceMetrics;
}) {
  const status = rowStatus(sentence);
  const failed = status.key === "refused" || status.key === "excluded" || status.key === "incomplete";
  return (
    <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>METEOR {sentence.meteor != null ? sentence.meteor.toFixed(3) : "--"}</span>
        {sentence.bertscore_f1 != null && (
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>BERTScore {sentence.bertscore_f1.toFixed(3)}</span>
        )}
        {status.key !== "completed" && (
          <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, ...bandStyle(status.tone) }}>{status.label}</span>
        )}
        {sentence.format_warning && (
          <span title={sentence.format_warning} style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, ...bandStyle("warning") }}>&#9888; {sentence.format_warning}</span>
        )}
      </div>
      {failed ? (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          <div style={{ fontStyle: "italic" }}>No translation. {splitRefusalError(sentence.error).reason}</div>
          {splitRefusalError(sentence.error).providerExplanation && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-primary)" }}>
              <strong>What the provider said:</strong> &ldquo;{splitRefusalError(sentence.error).providerExplanation}&rdquo;
            </div>
          )}
          {explainRefusal(sentence.error) && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>{explainRefusal(sentence.error)}</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {sentence.llm_english_translation}
        </div>
      )}
    </div>
  );
}

function SentenceDiffs({
  resultsA,
  resultsB,
  modelA,
  modelB,
  labelA,
  labelB,
  overrides,
  judgments,
  onJudge,
  onClearJudgment,
}: {
  resultsA: JobResults;
  resultsB: JobResults;
  modelA: string;
  modelB: string;
  labelA: string;
  labelB: string;
  overrides: Record<string, RefusalOverride>;
  judgments: Record<string, HeadToHeadJudgment>;
  onJudge: (pairId: string, preferred: string, note: string) => void;
  onClearJudgment: (pairId: string) => void;
}) {
  const [limit, setLimit] = useState<number>(DIFF_LIMITS[0]);
  const [openPair, setOpenPair] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const detailRef = useRef<HTMLDivElement | null>(null);

  const allDiffs = useMemo(() => {
    const rowsA = applyRefusalOverrides(resultsA.sentence_metrics, overrides);
    const rowsB = applyRefusalOverrides(resultsB.sentence_metrics, overrides);
    const mapB = new Map(rowsB.map((s) => [s.pair_id, s]));
    const pairs: { pairId: string; a: SentenceMetrics; b: SentenceMetrics; meteorA: number; meteorB: number; diff: number }[] = [];
    for (const a of rowsA) {
      const b = mapB.get(a.pair_id);
      if (b && a.meteor != null && b.meteor != null) {
        pairs.push({ pairId: a.pair_id, a, b, meteorA: a.meteor, meteorB: b.meteor, diff: Math.abs(a.meteor - b.meteor) });
      }
    }
    return pairs.sort((x, y) => y.diff - x.diff);
  }, [resultsA, resultsB, overrides]);

  const diffs = limit > 0 ? allDiffs.slice(0, limit) : allDiffs;
  const openDiff = openPair ? allDiffs.find((d) => d.pairId === openPair) ?? null : null;
  const openJudgment = openPair ? judgments[openPair] : undefined;

  // Previous / next step through the rows currently shown in the table, in
  // table order. If the open pair is no longer shown (the "Show" limit was
  // lowered), "next" starts again from the first row.
  const openIndex = openPair ? diffs.findIndex((d) => d.pairId === openPair) : -1;
  const prevDiff = openIndex > 0 ? diffs[openIndex - 1] : null;
  const nextDiff = openIndex === -1 ? diffs[0] ?? null : openIndex < diffs.length - 1 ? diffs[openIndex + 1] : null;
  const goPrev = () => { if (prevDiff) setOpenPair(prevDiff.pairId); };
  const goNext = () => { if (nextDiff) setOpenPair(nextDiff.pairId); };

  // Left / right arrow keys step through the list while a pair is open,
  // except when the reviewer is typing in the note box or another field.
  useEffect(() => {
    if (!openPair) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || t?.isContentEditable) return;
      if (e.key === "ArrowLeft" && prevDiff) { e.preventDefault(); setOpenPair(prevDiff.pairId); }
      if (e.key === "ArrowRight" && nextDiff) { e.preventDefault(); setOpenPair(nextDiff.pairId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPair, prevDiff, nextDiff]);

  // Bring the detail card into view when a row far down the table is opened.
  useEffect(() => {
    if (openPair && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [openPair]);

  // Reviewer preference tally over the rows currently shown
  const tally = useMemo(() => {
    let a = 0, b = 0, tie = 0;
    for (const d of diffs) {
      const j = judgments[d.pairId];
      if (!j) continue;
      if (j.preferred === "tie") tie += 1;
      else if (j.preferred === modelA) a += 1;
      else if (j.preferred === modelB) b += 1;
    }
    return { a, b, tie, judged: a + b + tie };
  }, [diffs, judgments, modelA, modelB]);

  useEffect(() => {
    setNoteDraft(openPair ? judgments[openPair]?.note ?? "" : "");
  }, [openPair, judgments]);

  if (allDiffs.length === 0) return null;

  const colorA = "var(--accent-text)";
  const colorB = "#7C3AED";

  const judgeButton = (pairId: string, value: string, text: string, color: string) => {
    const active = judgments[pairId]?.preferred === value;
    return (
      <button
        key={value}
        onClick={() => onJudge(pairId, value, noteDraft)}
        style={{
          fontFamily: "var(--font)", fontSize: 13, fontWeight: 600, padding: "10px 16px",
          borderRadius: "var(--radius-xs)", cursor: "pointer", minWidth: 0,
          border: active ? `1.5px solid ${color}` : "1px solid var(--border)",
          background: active ? "var(--bg-surface)" : "transparent",
          color: active ? color : "var(--text-secondary)",
        }}
      >
        {text}
      </button>
    );
  };

  const exportCSV = () => {
    const csv = exportHeadToHeadCSV(diffs.map((d) => ({ pairId: d.pairId, a: d.a, b: d.b })), modelA, modelB, judgments);
    downloadFile(csv, "medtranslate_head_to_head.csv");
  };

  return (
    <div className="anim d4" style={{ marginBottom: 48 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        Largest METEOR Score Differences
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* Controls + reviewer tally */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12, fontSize: 13, color: "var(--text-muted)" }}>
        <span>Show</span>
        {DIFF_LIMITS.map((n) => (
          <button
            key={n}
            onClick={() => setLimit(n)}
            style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 100, cursor: "pointer", border: limit === n ? "1px solid var(--accent)" : "1px solid var(--border)", background: limit === n ? "var(--accent-soft)" : "transparent", color: limit === n ? "var(--accent-text)" : "var(--text-secondary)" }}
          >
            {n === 0 ? `all ${allDiffs.length}` : n}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span>
          Your verdicts: <strong style={{ color: colorA }}>{labelA} {tally.a}</strong> &middot; <strong style={{ color: colorB }}>{labelB} {tally.b}</strong> &middot; Equal {tally.tie} &middot; {tally.judged} of {diffs.length} judged
        </span>
        <button
          onClick={exportCSV}
          style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
        >
          Export head-to-head CSV
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
        Click a row to read both outputs side by side and record which translation is actually better. Use Prev / Next (or the left and right arrow keys) to step through the list without closing the card. Your verdict is a human judgment, independent of the automated scores, and is saved with the export.
      </p>

      {/* Detail card for the selected sentence. Rendered above the table (not
          inside it) so it is full width on phones, where the table scrolls
          sideways, and stays in view when "all" rows are shown. */}
      {openDiff && (
        <div ref={detailRef} style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 20, boxShadow: "var(--shadow)", marginBottom: 16, border: "1px solid var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{openDiff.pairId}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>METEOR difference {openDiff.diff.toFixed(3)}</span>
            <span style={{ flex: 1 }} />
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={goPrev}
                disabled={!prevDiff}
                aria-label="Previous pair"
                title="Previous pair (left arrow key)"
                style={{ ...navButtonStyle, opacity: prevDiff ? 1 : 0.4, cursor: prevDiff ? "pointer" : "default" }}
              >
                <span aria-hidden="true">&#8249;</span> Prev
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 64, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                {openIndex === -1 ? "not in list" : `${openIndex + 1} of ${diffs.length}`}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={!nextDiff}
                aria-label="Next pair"
                title="Next pair (right arrow key)"
                style={{ ...navButtonStyle, opacity: nextDiff ? 1 : 0.4, cursor: nextDiff ? "pointer" : "default" }}
              >
                Next <span aria-hidden="true">&#8250;</span>
              </button>
            </div>
            <button onClick={() => setOpenPair(null)} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-muted)", lineHeight: 1, padding: "0 4px", marginLeft: 4 }}>&times;</button>
          </div>
          <div className="pair-grid" style={{ marginBottom: 16 }}>
            <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 16, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Source text</div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{openDiff.a.source_text || openDiff.a.spanish_source}</div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", margin: "16px 0 10px" }}>{languageLabel(targetLanguageOf(resultsA.translation_config))} reference</div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{openDiff.a.english_reference}</div>
            </div>
            <OutputPanel label={labelA} color={colorA} sentence={openDiff.a} />
            <OutputPanel label={labelB} color={colorB} sentence={openDiff.b} />
          </div>

          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
              Which translation is actually better?
            </div>
            <div className="button-row" style={{ marginBottom: 10 }}>
              {judgeButton(openDiff.pairId, modelA, `${labelA} is better`, colorA)}
              {judgeButton(openDiff.pairId, "tie", "About equal", "var(--text-secondary)")}
              {judgeButton(openDiff.pairId, modelB, `${labelB} is better`, colorB)}
              {openJudgment && (
                <button
                  onClick={() => onClearJudgment(openDiff.pairId)}
                  style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "10px 14px", borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", cursor: "pointer" }}
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              placeholder="Why? (optional: e.g. Opus dropped the negation; Sol expanded an abbreviation correctly)"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => { if (openJudgment && noteDraft !== openJudgment.note) onJudge(openDiff.pairId, openJudgment.preferred, noteDraft); }}
              style={{ fontFamily: "var(--font)", fontSize: 12, width: "100%", padding: "8px 12px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border)", background: "var(--bg-inset)", color: "var(--text-primary)", resize: "vertical", minHeight: 48, lineHeight: 1.5 }}
            />
            {!openJudgment && noteDraft && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Pick a verdict above to save this note.</div>
            )}
          </div>
        </div>
      )}

      <div className="table-scroll" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)" }}>
        <table>
          <thead>
            <tr>
              <th>Pair ID</th>
              <th style={{ textAlign: "center" }}>{labelA} METEOR</th>
              <th style={{ textAlign: "center" }}>{labelB} METEOR</th>
              <th style={{ textAlign: "center" }}>Difference</th>
              <th style={{ textAlign: "center" }}>Better (score)</th>
              <th style={{ textAlign: "center" }}>Your verdict</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => {
              const open = openPair === d.pairId;
              const j = judgments[d.pairId];
              const verdict = !j ? null : j.preferred === "tie" ? "Equal" : j.preferred === modelA ? labelA : j.preferred === modelB ? labelB : j.preferred;
              const verdictColor = !j ? "var(--text-muted)" : j.preferred === modelA ? colorA : j.preferred === modelB ? colorB : "var(--text-secondary)";
              return (
                  <tr
                    key={d.pairId}
                    onClick={() => setOpenPair(open ? null : d.pairId)}
                    style={{ cursor: "pointer", background: open ? "var(--accent-soft)" : undefined }}
                    aria-expanded={open}
                  >
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      <span style={{ marginRight: 8, color: "var(--text-muted)" }}>{open ? "\u25BE" : "\u25B8"}</span>{d.pairId}
                    </td>
                    <td style={{ textAlign: "center", fontWeight: 600, color: d.meteorA > d.meteorB ? colorA : "var(--text-primary)" }}>{d.meteorA.toFixed(3)}</td>
                    <td style={{ textAlign: "center", fontWeight: 600, color: d.meteorB > d.meteorA ? colorB : "var(--text-primary)" }}>{d.meteorB.toFixed(3)}</td>
                    <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>{d.diff.toFixed(3)}</td>
                    <td style={{ textAlign: "center" }}>
                      {d.meteorA > d.meteorB
                        ? <span style={{ fontSize: 11, fontWeight: 600, color: colorA }}>{labelA}</span>
                        : d.meteorB > d.meteorA
                        ? <span style={{ fontSize: 11, fontWeight: 600, color: colorB }}>{labelB}</span>
                        : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Tie</span>}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: verdictColor }}>{verdict ?? "\u2014"}</td>
                  </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
