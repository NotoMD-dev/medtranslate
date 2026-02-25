"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import { CLINICAL_GRADES } from "@/lib/types";
import { summarizeMetric } from "@/lib/metrics";
import type { JobResults, ClinicalGrade } from "@/lib/types";
import { getSessionJobResultsAsync, getSessionGrades } from "@/lib/session";

export default function MetricsPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});

  useEffect(() => {
    getSessionJobResultsAsync().then((persisted) => {
      if (persisted) setJobResults(persisted);
    });
    const persistedGrades = getSessionGrades();
    if (persistedGrades) setGrades(persistedGrades);
  }, []);

  const sentences = jobResults?.sentence_metrics ?? [];
  const completed = sentences.filter(
    (s) => s.llm_english_translation && !s.error
  );

  // Aggregate metric values from backend results
  const meteorValues = completed
    .map((r) => r.meteor)
    .filter((v): v is number => v != null);
  const bertValues = completed
    .map((r) => r.bertscore_f1)
    .filter((v): v is number => v != null);

  const meteorSummary = summarizeMetric(meteorValues);
  const bertSummary = summarizeMetric(bertValues);
  const hasBertscore = bertValues.length > 0;

  // Clinical grade distribution
  const graded = completed.filter((r) => grades[r.pair_id] != null);
  const gradeCounts = CLINICAL_GRADES.map(
    (g) => graded.filter((r) => grades[r.pair_id] === g.grade).length
  );
  const totalGraded = graded.length;

  // Performance by source
  const sources = [
    {
      key: "ClinSpEn_ClinicalCases" as const,
      label: "ClinSpEn (Case Reports)",
      color: "#7dd3fc",
    },
    {
      key: "UMass_EHR" as const,
      label: "UMass (EHR Notes)",
      color: "#fda4af",
    },
  ];

  const sourceMetrics = sources.map((src) => {
    const srcCompleted = completed.filter((r) => r.source === src.key);
    const srcMeteor = srcCompleted
      .map((r) => r.meteor)
      .filter((v): v is number => v != null);
    const srcBert = srcCompleted
      .map((r) => r.bertscore_f1)
      .filter((v): v is number => v != null);
    return {
      ...src,
      count: srcCompleted.length,
      meteor: srcMeteor.length > 0 ? summarizeMetric(srcMeteor).mean : null,
      bert: srcBert.length > 0 ? summarizeMetric(srcBert).mean : null,
    };
  });

  const corpusBleu = jobResults?.corpus_metrics;

  // Flagged count
  const flaggedCount = completed.filter((r) => r.meteor != null && r.meteor < 0.4).length;
  const flaggedPct = completed.length > 0 ? ((flaggedCount / completed.length) * 100).toFixed(1) : "0";

  // Grade distribution colors mapped to design system
  const gradeColors = ["var(--success)", "var(--accent)", "var(--warning)", "var(--danger)"];
  const maxGradeCount = Math.max(...gradeCounts, 1);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 40px 96px" }}>
      <Header />

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          Aggregate Metrics
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          {completed.length > 0 ? (
            <><strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{completed.length}</strong> of {sentences.length} translations completed</>
          ) : (
            "Run translations first to see metrics here."
          )}
        </p>
      </div>

      {/* Corpus-Level Scores */}
      {corpusBleu && (
        <div className="anim d1" style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
            Corpus-Level Scores
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>SacreBLEU</div>
              <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
                {corpusBleu.overall.bleu_score.toFixed(2)}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 12 }}>
                {corpusBleu.overall.bleu_signature}
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--warning-light)", color: "var(--warning)", border: "1px solid var(--warning-border)" }}>
                Moderate
              </span>
            </div>
            <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>METEOR</div>
              <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
                {meteorValues.length > 0 ? meteorSummary.mean.toFixed(3) : "--"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 12 }}>
                WordNet + stemming (NLTK)<br />n = {meteorValues.length}
              </div>
              {meteorValues.length > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--success-light)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                  Strong
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BERTScore card if available */}
      {hasBertscore && (
        <div className="anim d2" style={{ marginBottom: 48 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>BERTScore F1</div>
              <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
                {bertSummary.mean.toFixed(3)}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Rescaled with baseline (roberta-base)<br />n = {bertValues.length}
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasBertscore && completed.length > 0 && (
        <div style={{ marginBottom: 28, padding: 12, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text-muted)", boxShadow: "var(--shadow)" }}>
          BERTScore was not computed for this run. To include it, enable the &quot;Include BERTScore&quot; toggle on the Translate page before running.
        </div>
      )}

      {/* Flagged Translations */}
      <div className="anim d2" style={{ marginBottom: 48 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          Flagged Translations
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)", maxWidth: 480 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Flagged for Review</div>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
            {flaggedCount}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 12 }}>
            Threshold: METEOR &lt; 0.40 &middot; {totalGraded} of {flaggedCount} graded
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--accent-soft)", color: "var(--accent-text)" }}>
            {flaggedPct}% of total
          </span>
        </div>
      </div>

      {/* Clinical Grading Progress */}
      <div className="anim d3" style={{ marginBottom: 48 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          Clinical Grading Progress
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Clinical Significance Grades</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 120, height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--accent)", borderRadius: 100, width: `${flaggedCount > 0 ? (totalGraded / flaggedCount) * 100 : 0}%` }} />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>{totalGraded} / {flaggedCount} graded</span>
            </div>
          </div>
          {CLINICAL_GRADES.map((g, i) => (
            <div key={g.grade} style={{ display: "grid", gridTemplateColumns: "180px 1fr 48px", alignItems: "center", gap: 16, padding: "16px 0", borderBottom: i < CLINICAL_GRADES.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: gradeColors[i] }} />
                Grade {g.grade} &middot; {g.label}
              </div>
              <div style={{ height: 8, background: "var(--bg-inset)", borderRadius: 100, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 100, transition: "width 0.5s ease", width: `${maxGradeCount > 0 ? (gradeCounts[i] / maxGradeCount) * 100 : 0}%`, background: gradeColors[i] }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", textAlign: "right" }}>{gradeCounts[i]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Breakdown by Dataset */}
      <div className="anim d4" style={{ marginBottom: 48 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          Breakdown by Dataset
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Pairs</th>
                {corpusBleu && <th>SacreBLEU</th>}
                <th>METEOR</th>
                {hasBertscore && <th>BERTScore</th>}
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {sourceMetrics.map((src) => {
                const srcFlagged = completed.filter((r) => r.source === src.key && r.meteor != null && r.meteor < 0.4).length;
                const corpusVal = corpusBleu ? (src.key === "ClinSpEn_ClinicalCases" ? corpusBleu.clinspen : corpusBleu.umass) : null;
                return (
                  <tr key={src.key}>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-primary)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: src.key === "ClinSpEn_ClinicalCases" ? "var(--accent)" : "#7C3AED" }} />
                        {src.key === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : "UMass"}
                      </span>
                    </td>
                    <td>{src.count.toLocaleString()}</td>
                    {corpusBleu && <td>{corpusVal ? corpusVal.bleu_score.toFixed(2) : "--"}</td>}
                    <td>{src.meteor != null ? src.meteor.toFixed(3) : "--"}</td>
                    {hasBertscore && <td>{src.bert != null ? src.bert.toFixed(3) : "--"}</td>}
                    <td>{srcFlagged}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-muted)" }}>Combined</td>
                <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-primary)" }}>{completed.length.toLocaleString()}</td>
                {corpusBleu && <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-primary)" }}>{corpusBleu.overall.bleu_score.toFixed(2)}</td>}
                <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-primary)" }}>{meteorValues.length > 0 ? meteorSummary.mean.toFixed(3) : "--"}</td>
                {hasBertscore && <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-primary)" }}>{bertSummary.mean.toFixed(3)}</td>}
                <td style={{ background: "var(--bg-inset)", fontWeight: 600, color: "var(--text-primary)" }}>{flaggedCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Library versions */}
      {jobResults?.library_versions && (
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", paddingTop: 8 }}>
          MedTranslate &middot; sacrebleu {jobResults.library_versions.sacrebleu} &middot; nltk {jobResults.library_versions.nltk}
          {jobResults.library_versions.bert_score && jobResults.library_versions.bert_score !== "not loaded" && (
            <> &middot; bert-score {jobResults.library_versions.bert_score}</>
          )}
          {jobResults.library_versions.torch && jobResults.library_versions.torch !== "not loaded" && (
            <> &middot; torch {jobResults.library_versions.torch}</>
          )}
        </div>
      )}
    </div>
  );
}
