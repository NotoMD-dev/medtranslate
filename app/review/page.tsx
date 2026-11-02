"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Header from "@/components/Header";
import { languageLabel, targetLanguageOf } from "@/lib/types";
import { CLINICAL_GRADES, REFERENCE_FLAG_REASONS } from "@/lib/types";
import { exportReviewCSV, downloadFile } from "@/lib/csv";
import { DEFAULT_REVIEW_THRESHOLD, isCompleted, isRefused, isExcluded, applyRefusalOverrides, explainRefusal, splitRefusalError } from "@/lib/metrics";
import {
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  setSessionGradesAsync,
  getSessionRefFlagsAsync,
  setSessionRefFlagsAsync,
  getSessionReviewThreshold,
  setSessionReviewThreshold,
  getSessionRefusalOverrides,
  setSessionRefusalOverrides,
} from "@/lib/session";

function sourceLabel(source: string): string {
  if (source === "ClinSpEn_ClinicalCases") return "ClinSpEn";
  if (source === "UMass_EHR") return "UMass";
  return source || "Unknown";
}
import type { JobResults, SentenceMetrics, ClinicalGrade, ReferenceFlag, ReferenceFlagReason, RefusalOverride } from "@/lib/types";

type ReviewView = "queue" | "table";

export default function ReviewPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  // Translations and references are in the run's target language.
  const targetLabel = languageLabel(targetLanguageOf(jobResults?.translation_config));
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [refFlags, setRefFlags] = useState<Record<string, ReferenceFlag>>({});
  const [threshold, setThreshold] = useState(DEFAULT_REVIEW_THRESHOLD);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_REVIEW_THRESHOLD));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [view, setView] = useState<ReviewView>("queue");
  const [jumpInput, setJumpInput] = useState("");
  const [refFlagOpen, setRefFlagOpen] = useState(false);
  const [showGradeInfo, setShowGradeInfo] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, RefusalOverride>>({});
  const [overrideNote, setOverrideNote] = useState("");

  useEffect(() => {
    // The threshold is shared with the Metrics page's "Flagged for Review" count.
    const savedThreshold = getSessionReviewThreshold();
    if (savedThreshold != null) {
      setThreshold(savedThreshold);
      setThresholdInput(String(savedThreshold));
    }
    setOverrides(getSessionRefusalOverrides());
    getSessionJobResultsAsync().then((persisted) => {
      if (persisted) setJobResults(persisted);
    });
    getSessionGradesAsync().then((persistedGrades) => {
      if (persistedGrades) setGrades(persistedGrades);
    });
    getSessionRefFlagsAsync().then((persistedFlags) => {
      if (persistedFlags) setRefFlags(persistedFlags);
    });
  }, []);

  // Reviewer refusal overrides are applied on top of the stored results.
  const sentences = useMemo(
    () => applyRefusalOverrides(jobResults?.sentence_metrics ?? [], overrides),
    [jobResults, overrides]
  );

  // Reviewable rows: completed translations, refusals (scored 0 by the
  // backend), and refusals a reviewer has excluded (kept visible so the
  // decision can be undone). Incomplete rows (provider/config failures) are
  // not reviewable; they are retried from the Translate page.
  const completed = useMemo(
    () => sentences.filter((s) => isCompleted(s) || isRefused(s) || isExcluded(s)),
    [sentences]
  );

  // Queue: refusals and excluded refusals first, then pairs below the
  // configurable METEOR threshold in dataset order.
  const flagged = useMemo(() => {
    const below = completed.filter((r) => isExcluded(r) || (r.meteor != null && r.meteor < threshold));
    const first = below.filter((r) => isRefused(r) || isExcluded(r));
    return [...first, ...below.filter((r) => !isRefused(r) && !isExcluded(r))];
  }, [completed, threshold]);
  const refusedCount = useMemo(() => flagged.filter(isRefused).length, [flagged]);

  // A pair is handled when it has a grade or was excluded by the reviewer.
  const gradedCount = useMemo(
    () => flagged.filter((r) => grades[r.pair_id] != null || isExcluded(r)).length,
    [flagged, grades]
  );

  const handleExclude = useCallback((pairId: string, note: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [pairId]: { note: note.trim(), at: new Date().toISOString() } };
      setSessionRefusalOverrides(next);
      return next;
    });
    setOverrideNote("");
  }, []);

  const handleUndoExclude = useCallback((pairId: string) => {
    setOverrides((prev) => {
      const { [pairId]: _, ...rest } = prev;
      setSessionRefusalOverrides(rest);
      return rest;
    });
  }, []);

  const gradeCounts = CLINICAL_GRADES.map(
    (g) => flagged.filter((r) => grades[r.pair_id] === g.grade).length
  );

  const handleGrade = useCallback(
    async (pairId: string, grade: ClinicalGrade) => {
      setGrades((prev) => {
        const next = { ...prev, [pairId]: grade };
        // Fire-and-forget async persistence
        setSessionGradesAsync(next);
        return next;
      });
    },
    []
  );

  const handleRefFlagToggle = useCallback(
    (pairId: string, reason: ReferenceFlagReason) => {
      setRefFlags((prev) => {
        const existing = prev[pairId] ?? { reasons: [], notes: "" };
        const hasReason = existing.reasons.includes(reason);
        const nextReasons = hasReason
          ? existing.reasons.filter((r) => r !== reason)
          : [...existing.reasons, reason];
        const next = nextReasons.length === 0 && !existing.notes
          ? (() => { const { [pairId]: _, ...rest } = prev; return rest; })()
          : { ...prev, [pairId]: { ...existing, reasons: nextReasons } };
        setSessionRefFlagsAsync(next);
        return next;
      });
    },
    []
  );

  const handleRefFlagNotes = useCallback(
    (pairId: string, notes: string) => {
      setRefFlags((prev) => {
        const existing = prev[pairId] ?? { reasons: [], notes: "" };
        const next = !notes && existing.reasons.length === 0
          ? (() => { const { [pairId]: _, ...rest } = prev; return rest; })()
          : { ...prev, [pairId]: { ...existing, notes } };
        setSessionRefFlagsAsync(next);
        return next;
      });
    },
    []
  );

  const handleClearRefFlag = useCallback(
    (pairId: string) => {
      setRefFlags((prev) => {
        const { [pairId]: _, ...rest } = prev;
        setSessionRefFlagsAsync(rest);
        return rest;
      });
    },
    []
  );

  const handleThresholdApply = useCallback(() => {
    const val = parseFloat(thresholdInput);
    if (!isNaN(val) && val >= 0 && val <= 1) {
      setThreshold(val);
      setSessionReviewThreshold(val);
      setCurrentIndex(0);
    }
  }, [thresholdInput]);

  const handleJump = useCallback(() => {
    const val = parseInt(jumpInput, 10);
    if (!isNaN(val) && val >= 1 && val <= flagged.length) {
      setCurrentIndex(val - 1);
      setJumpInput("");
    }
  }, [jumpInput, flagged.length]);

  const handleExport = useCallback(() => {
    if (!jobResults || flagged.length === 0) return;
    const csv = exportReviewCSV(flagged, grades, refFlags, overrides);
    downloadFile(csv, "medtranslate_review.csv");
  }, [jobResults, flagged, grades, refFlags, overrides]);

  // Navigate to next ungraded pair
  const handleSkip = useCallback(() => {
    const nextUngraded = flagged.findIndex(
      (r, i) => i > currentIndex && grades[r.pair_id] == null && !isExcluded(r)
    );
    if (nextUngraded !== -1) {
      setCurrentIndex(nextUngraded);
    } else {
      // Wrap around: find first ungraded from the start
      const firstUngraded = flagged.findIndex(
        (r) => grades[r.pair_id] == null && !isExcluded(r)
      );
      if (firstUngraded !== -1) {
        setCurrentIndex(firstUngraded);
      }
    }
  }, [flagged, grades, currentIndex]);

  // Close the ref flag panel when navigating to a different pair
  useEffect(() => { setRefFlagOpen(false); }, [currentIndex]);

  const currentPair: SentenceMetrics | null = flagged[currentIndex] ?? null;

  const noData = completed.length === 0;

  return (
    <div className="page-container">
      <Header />

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          Clinical Safety Review
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          {gradedCount} / {flagged.length} graded
        </p>
      </div>

      {/* Progress */}
      <div className="anim d1" style={{ marginBottom: 32 }}>
        <div style={{ height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
          <div style={{ height: "100%", background: "var(--accent)", borderRadius: 100, transition: "width 0.6s ease", width: `${flagged.length > 0 ? (gradedCount / flagged.length) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Threshold control */}
      <div className="anim d1 threshold-bar">
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>METEOR Threshold:</span>
        <input
          type="number" min="0" max="1" step="0.05"
          value={thresholdInput}
          onChange={(e) => setThresholdInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleThresholdApply()}
          style={{ width: 80, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font)" }}
        />
        <button
          onClick={handleThresholdApply}
          style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
        >
          Apply
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {flagged.length} pair{flagged.length === 1 ? "" : "s"} below {threshold}
          {refusedCount > 0 && <> (incl. <span style={{ color: "var(--danger)", fontWeight: 600 }}>{refusedCount} refused</span>)</>}
        </span>
        <span style={{ flex: 1 }} />
        {/* View toggle */}
        <button
          onClick={() => setView("queue")}
          style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 500, color: view === "queue" ? "var(--accent-text)" : "var(--text-muted)", background: "none", border: "none", borderBottom: view === "queue" ? "2px solid var(--accent)" : "2px solid transparent", padding: "4px 0", cursor: "pointer" }}
        >
          Queue
        </button>
        <button
          onClick={() => setView("table")}
          style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 500, color: view === "table" ? "var(--accent-text)" : "var(--text-muted)", background: "none", border: "none", borderBottom: view === "table" ? "2px solid var(--accent)" : "2px solid transparent", padding: "4px 0", cursor: "pointer" }}
        >
          Table
        </button>
        <button
          onClick={handleExport}
          disabled={!jobResults || flagged.length === 0}
          style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: !jobResults || flagged.length === 0 ? "not-allowed" : "pointer", opacity: !jobResults || flagged.length === 0 ? 0.4 : 1 }}
        >
          Export Review
        </button>
      </div>

      {noData ? (
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 48, textAlign: "center", boxShadow: "var(--shadow)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 18, marginBottom: 8 }}>Run translations first</div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Complete batch translations on the Translate tab to populate this view.
          </p>
        </div>
      ) : flagged.length === 0 ? (
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 48, textAlign: "center", boxShadow: "var(--shadow)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 18, marginBottom: 8 }}>No pairs below threshold</div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No completed translations have a METEOR score below {threshold}.
          </p>
        </div>
      ) : view === "queue" ? (
        <div>
          {/* Navigation bar */}
          <div className="anim d1 review-nav">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-muted)", border: "none", cursor: currentIndex === 0 ? "not-allowed" : "pointer", opacity: currentIndex === 0 ? 0.4 : 1 }}
              >
                Prev
              </button>
              <button
                onClick={() => setCurrentIndex(Math.min(flagged.length - 1, currentIndex + 1))}
                disabled={currentIndex >= flagged.length - 1}
                style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: currentIndex >= flagged.length - 1 ? "not-allowed" : "pointer", opacity: currentIndex >= flagged.length - 1 ? 0.4 : 1 }}
              >
                Next
              </button>
              <button
                onClick={handleSkip}
                style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
              >
                Skip to Ungraded
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{currentIndex + 1} / {flagged.length}</span>
              <input
                type="text"
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJump()}
                placeholder="Jump to"
                style={{ fontFamily: "var(--font)", fontSize: 13, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg-surface)", color: "var(--text-primary)", width: 72 }}
              />
              <button
                onClick={handleJump}
                style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                Go
              </button>
            </div>
          </div>

          {/* Current pair detail card */}
          {currentPair && (
            <div className="anim d2" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)", marginBottom: 24 }}>
              {/* Pair header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{currentPair.pair_id}</span>
                <span
                  className={currentPair.source !== "ClinSpEn_ClinicalCases" ? "badge-dataset-umass" : ""}
                  style={{
                    display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600,
                    background: currentPair.source === "ClinSpEn_ClinicalCases" ? "var(--accent-soft)" : undefined,
                    color: currentPair.source === "ClinSpEn_ClinicalCases" ? "var(--accent-text)" : undefined,
                  }}
                >
                  {sourceLabel(currentPair.source)}
                </span>
                {isRefused(currentPair) && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: "var(--danger)", color: "#fff", border: "1px solid var(--danger)" }}>
                    Refused
                  </span>
                )}
                {isExcluded(currentPair) && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: "var(--bg-inset)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    Excluded by reviewer
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--danger-light)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                  METEOR {currentPair.meteor?.toFixed(3) ?? "--"}
                </span>
                {currentPair.format_warning && (
                  <span title={currentPair.format_warning} style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--warning-light)", color: "var(--warning)", border: "1px solid var(--warning-border)" }}>
                    &#9888; Format: {currentPair.format_warning}
                  </span>
                )}
                {currentPair.bertscore_f1 != null && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                    BERTScore {currentPair.bertscore_f1.toFixed(3)}
                  </span>
                )}
                {grades[currentPair.pair_id] != null && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--danger-light)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                    Grade {grades[currentPair.pair_id]}
                  </span>
                )}
                {refFlags[currentPair.pair_id] && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--warning-light)", color: "var(--warning)", border: "1px solid var(--warning-border)" }}>
                    Ref. Flagged
                  </span>
                )}
              </div>

              {/* Three columns */}
              <div className="review-grid">
                <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Source Text</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 256, overflow: "auto" }}>{currentPair.source_text || currentPair.spanish_source}</div>
                </div>
                <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>LLM {targetLabel} Translation</div>
                  {isExcluded(currentPair) ? (
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)", padding: 12, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)" }}>
                      <strong>No translation. Refusal judged legitimate by a reviewer; excluded from all scores.</strong>
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>{currentPair.error}</div>
                      {overrides[currentPair.pair_id]?.note && (
                        <div style={{ marginTop: 6, fontSize: 12 }}>Reviewer note: {overrides[currentPair.pair_id].note}</div>
                      )}
                    </div>
                  ) : isRefused(currentPair) ? (
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--danger)", padding: 12, background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-xs)" }}>
                      <strong>No translation. The model refused or returned nothing.</strong>
                      <div style={{ marginTop: 6, fontSize: 12 }}>{splitRefusalError(currentPair.error).reason}</div>
                      {splitRefusalError(currentPair.error).providerExplanation && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-primary)" }}>
                          <strong>What the provider said:</strong> &ldquo;{splitRefusalError(currentPair.error).providerExplanation}&rdquo;
                        </div>
                      )}
                      {explainRefusal(currentPair.error) && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>{explainRefusal(currentPair.error)}</div>
                      )}
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>Scored as 0. Grade the clinical impact of a missing translation for this sentence, or flag the reference if the source text itself is the problem.</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 256, overflow: "auto" }}>{currentPair.llm_english_translation}</div>
                  )}
                </div>
                <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>{targetLabel} Reference (Gold Standard)</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 256, overflow: "auto" }}>{currentPair.english_reference}</div>
                </div>
              </div>

              {/* Grading controls */}
              <div className="grade-controls">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    Assign Clinical Significance Grade:
                    <button
                      onClick={() => setShowGradeInfo((v) => !v)}
                      aria-label="Show grading scale definitions"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 16, height: 16, borderRadius: "50%",
                        border: "1px solid var(--text-muted)", fontSize: 11,
                        fontWeight: 700, color: "var(--text-muted)", lineHeight: 1,
                        background: "transparent", cursor: "pointer", padding: 0,
                      }}
                    >?</button>
                  </div>
                  <div className="grade-buttons">
                    {CLINICAL_GRADES.map((g) => {
                      const isActive = grades[currentPair.pair_id] === g.grade;
                      return (
                        <button
                          key={g.grade}
                          onClick={() => handleGrade(currentPair.pair_id, g.grade)}
                          title={g.description}
                          style={{
                            fontFamily: "var(--font)", fontSize: 12, fontWeight: 500,
                            padding: "10px 20px", borderRadius: "var(--radius-xs)",
                            border: isActive ? `1px solid var(--accent)` : "1px solid var(--border)",
                            background: isActive ? "var(--accent-soft)" : "transparent",
                            color: isActive ? "var(--accent-text)" : "var(--text-secondary)",
                            cursor: "pointer", textAlign: "center", minWidth: 72,
                          }}
                        >
                          <span style={{ display: "block", fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{g.grade}</span>
                          <span style={{ display: "block", fontSize: 10, opacity: 0.7 }}>{g.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => setCurrentIndex(Math.min(flagged.length - 1, currentIndex + 1))}
                  disabled={currentIndex >= flagged.length - 1}
                  style={{
                    fontFamily: "var(--font)", fontSize: 13, fontWeight: 500,
                    padding: "10px 24px", borderRadius: "var(--radius-sm)",
                    background: "var(--accent)", color: "#fff", border: "none",
                    cursor: currentIndex >= flagged.length - 1 ? "not-allowed" : "pointer",
                    opacity: currentIndex >= flagged.length - 1 ? 0.4 : 1,
                  }}
                >
                  Next Pair &rarr;
                </button>
              </div>

              {/* Reviewer override for refusals */}
              {(isRefused(currentPair) || isExcluded(currentPair)) && (
                <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 20, paddingTop: 16 }}>
                  {isExcluded(currentPair) ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", flex: 1, minWidth: 200 }}>
                        This refusal is excluded from METEOR, BERTScore, and (after re-scoring on the Translate page) corpus BLEU.
                      </span>
                      <button
                        onClick={() => handleUndoExclude(currentPair.pair_id)}
                        style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
                      >
                        Undo exclusion
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: "12px 16px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Was this refusal legitimate?</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                        If the source text is not clinical, not translatable, or the model was right to decline, exclude it so the refusal does not count against the model. This applies to every model&rsquo;s run for this pair. Otherwise grade the clinical impact of the missing translation above.
                      </div>
                      <textarea
                        placeholder="Reason (optional, included in the export)"
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                        style={{ fontFamily: "var(--font)", fontSize: 12, width: "100%", padding: "8px 12px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)", resize: "vertical", minHeight: 48, lineHeight: 1.5, marginBottom: 8 }}
                      />
                      <button
                        onClick={() => handleExclude(currentPair.pair_id, overrideNote)}
                        style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 600, padding: "8px 16px", borderRadius: "var(--radius-xs)", background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
                      >
                        Mark refusal as legitimate (exclude from scores)
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Reference quality flag */}
              <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 20, paddingTop: 16 }}>
                <button
                  onClick={() => setRefFlagOpen(!refFlagOpen)}
                  style={{
                    fontFamily: "var(--font)", display: "flex", alignItems: "center", gap: 10,
                    cursor: "pointer", userSelect: "none", width: "100%",
                    padding: "12px 16px", borderRadius: "var(--radius-xs)",
                    background: refFlags[currentPair.pair_id] ? "var(--warning-light)" : "var(--bg-inset)",
                    border: refFlags[currentPair.pair_id] ? "1px solid var(--warning-border)" : "1px solid var(--border)",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{refFlags[currentPair.pair_id] ? "\u26A0" : "\u2691"}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: refFlags[currentPair.pair_id] ? "var(--warning)" : "var(--text-secondary)" }}>
                    Flag Reference Translation Issue
                  </span>
                  {refFlags[currentPair.pair_id] && (
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, background: "var(--warning)", color: "#fff" }}>
                      {refFlags[currentPair.pair_id].reasons.length} issue{refFlags[currentPair.pair_id].reasons.length !== 1 ? "s" : ""} flagged
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{refFlagOpen ? "\u25B2" : "\u25BC"}</span>
                </button>
                {refFlagOpen && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                      Select issues with the reference (gold standard) translation:
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      {REFERENCE_FLAG_REASONS.map((r) => {
                        const isActive = refFlags[currentPair.pair_id]?.reasons.includes(r.reason) ?? false;
                        return (
                          <button
                            key={r.reason}
                            onClick={() => handleRefFlagToggle(currentPair.pair_id, r.reason)}
                            title={r.description}
                            style={{
                              fontFamily: "var(--font)", fontSize: 11, fontWeight: 500,
                              padding: "6px 12px", borderRadius: "var(--radius-xs)",
                              border: isActive ? "1px solid var(--warning)" : "1px solid var(--border)",
                              background: isActive ? "var(--warning-light)" : "transparent",
                              color: isActive ? "var(--warning)" : "var(--text-secondary)",
                              cursor: "pointer", transition: "all 0.15s",
                            }}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      placeholder="Optional notes for the interpreter (e.g. what seems wrong, which part is inaccurate)..."
                      value={refFlags[currentPair.pair_id]?.notes ?? ""}
                      onChange={(e) => handleRefFlagNotes(currentPair.pair_id, e.target.value)}
                      style={{
                        fontFamily: "var(--font)", fontSize: 12, width: "100%",
                        padding: "8px 12px", borderRadius: "var(--radius-xs)",
                        border: "1px solid var(--border)", background: "var(--bg-inset)",
                        color: "var(--text-primary)", resize: "vertical", minHeight: 56,
                        lineHeight: 1.5,
                      }}
                    />
                    {refFlags[currentPair.pair_id] && (
                      <button
                        onClick={() => handleClearRefFlag(currentPair.pair_id)}
                        style={{
                          fontFamily: "var(--font)", fontSize: 11, fontWeight: 500,
                          padding: "4px 10px", borderRadius: "var(--radius-xs)",
                          background: "transparent", color: "var(--text-muted)",
                          border: "1px solid var(--border)", cursor: "pointer",
                          marginTop: 8,
                        }}
                      >
                        Clear flag
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Flagged pairs collapsible list */}
          <div className="anim d3" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
            <div
              onClick={(e) => {
                const tags = (e.currentTarget as HTMLDivElement).nextElementSibling as HTMLDivElement;
                if (tags) tags.style.display = tags.style.display === "none" ? "flex" : "none";
              }}
              style={{ fontSize: 13, color: "var(--text-muted)", cursor: "pointer", transition: "color 0.2s" }}
            >
              &#9662; All Flagged Pairs (click to jump)
            </div>
            <div style={{ display: "none", flexWrap: "wrap", gap: 6, paddingTop: 12 }}>
              {flagged.map((r, i) => (
                <span
                  key={`${r.pair_id}-${i}`}
                  onClick={() => setCurrentIndex(i)}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 100,
                    background: "var(--bg-inset)", color: "var(--text-secondary)",
                    cursor: "pointer", transition: "all 0.15s",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {r.pair_id}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ========== TABLE VIEW ========== */
        <div className="anim d2" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
            {flagged.length} flagged pair{flagged.length === 1 ? "" : "s"} (METEOR &lt; {threshold})
          </div>
          <div style={{ maxHeight: 520, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pair ID</th>
                  <th>Source</th>
                  <th>Source Text (input)</th>
                  <th>LLM {targetLabel} (output)</th>
                  <th>METEOR</th>
                  <th>Grade</th>
                  <th>Ref. Flag</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((r, i) => (
                  <tr
                    key={`${r.pair_id}-${i}`}
                    onClick={() => { setCurrentIndex(i); setView("queue"); }}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                    <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{r.pair_id}</td>
                    <td>
                      <span
                        className={r.source !== "ClinSpEn_ClinicalCases" ? "badge-dataset-umass" : ""}
                        style={{
                          display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600,
                          background: r.source === "ClinSpEn_ClinicalCases" ? "var(--accent-soft)" : undefined,
                          color: r.source === "ClinSpEn_ClinicalCases" ? "var(--accent-text)" : undefined,
                        }}
                      >
                        {sourceLabel(r.source)}
                      </span>
                    </td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.source_text || r.spanish_source}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isRefused(r) ? "var(--danger)" : isExcluded(r) ? "var(--text-muted)" : undefined }} title={r.error ?? r.format_warning ?? undefined}>
                      {isRefused(r) ? <strong>Refused: </strong> : isExcluded(r) ? <strong>Excluded: </strong> : r.format_warning ? <span style={{ color: "var(--warning)" }}>&#9888; </span> : null}
                      {isRefused(r) || isExcluded(r) ? r.error : r.llm_english_translation}
                    </td>
                    <td style={{ color: "var(--accent-text)", fontWeight: 600 }}>{r.meteor?.toFixed(3) ?? "--"}</td>
                    <td>
                      {grades[r.pair_id] != null ? (
                        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: CLINICAL_GRADES[grades[r.pair_id]].bg, color: CLINICAL_GRADES[grades[r.pair_id]].color }}>
                          {grades[r.pair_id]}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>--</span>
                      )}
                    </td>
                    <td>
                      {refFlags[r.pair_id] ? (
                        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 10, fontWeight: 600, background: "var(--warning-light)", color: "var(--warning)" }}>
                          {refFlags[r.pair_id].reasons.length} issue{refFlags[r.pair_id].reasons.length !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Grade info modal - centered overlay */}
      {showGradeInfo && (
        <>
          <div
            onClick={() => setShowGradeInfo(false)}
            style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.25)" }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            zIndex: 1000, background: "var(--bg-primary, #fff)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 8px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: "24px 28px",
            width: 620, maxWidth: "90vw", fontSize: 13, color: "var(--text-primary)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Clinical Grading Scale</span>
              <button
                onClick={() => setShowGradeInfo(false)}
                aria-label="Close"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 18, color: "var(--text-muted)", padding: "0 4px", lineHeight: 1,
                }}
              >&times;</button>
            </div>
            <div className="table-scroll" style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600 }}>Grade</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600 }}>Category</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600 }}>Definition</th>
                </tr>
              </thead>
              <tbody>
                {CLINICAL_GRADES.map((g) => (
                  <tr key={g.grade} style={{ borderBottom: "1px solid var(--border-subtle, #eee)" }}>
                    <td style={{ padding: "10px 10px", fontWeight: 600 }}>{g.grade}</td>
                    <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>{g.label}</td>
                    <td className="wrap" style={{ padding: "10px 10px", minWidth: 220 }}>{g.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
