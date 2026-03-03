"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Header from "@/components/Header";
import { CLINICAL_GRADES, REFERENCE_FLAG_REASONS } from "@/lib/types";
import { exportReviewCSV, downloadFile } from "@/lib/csv";
import {
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  setSessionGradesAsync,
  getSessionRefFlagsAsync,
  setSessionRefFlagsAsync,
} from "@/lib/session";
import type { JobResults, SentenceMetrics, ClinicalGrade, ReferenceFlag, ReferenceFlagReason } from "@/lib/types";

type ReviewView = "queue" | "table";

export default function ReviewPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [refFlags, setRefFlags] = useState<Record<string, ReferenceFlag>>({});
  const [threshold, setThreshold] = useState(0.4);
  const [thresholdInput, setThresholdInput] = useState("0.4");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [view, setView] = useState<ReviewView>("queue");
  const [jumpInput, setJumpInput] = useState("");
  const [refFlagOpen, setRefFlagOpen] = useState(false);

  useEffect(() => {
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

  const sentences = jobResults?.sentence_metrics ?? [];

  const completed = useMemo(
    () => sentences.filter((s) => s.llm_english_translation && !s.error),
    [sentences]
  );

  // Filter pairs below the configurable METEOR threshold
  const flagged = useMemo(
    () => completed.filter((r) => r.meteor != null && r.meteor < threshold),
    [completed, threshold]
  );

  const gradedCount = useMemo(
    () => flagged.filter((r) => grades[r.pair_id] != null).length,
    [flagged, grades]
  );

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
    const csv = exportReviewCSV(flagged, grades, refFlags);
    downloadFile(csv, "medtranslate_review.csv");
  }, [jobResults, flagged, grades, refFlags]);

  // Navigate to next ungraded pair
  const handleSkip = useCallback(() => {
    const nextUngraded = flagged.findIndex(
      (r, i) => i > currentIndex && grades[r.pair_id] == null
    );
    if (nextUngraded !== -1) {
      setCurrentIndex(nextUngraded);
    } else {
      // Wrap around: find first ungraded from the start
      const firstUngraded = flagged.findIndex(
        (r) => grades[r.pair_id] == null
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
                  {currentPair.source === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : "UMass"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--danger-light)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                  METEOR {currentPair.meteor?.toFixed(3) ?? "--"}
                </span>
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
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>LLM English Translation</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 256, overflow: "auto" }}>{currentPair.llm_english_translation}</div>
                </div>
                <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>English Reference (Gold Standard)</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 256, overflow: "auto" }}>{currentPair.english_reference}</div>
                </div>
              </div>

              {/* Grading controls */}
              <div className="grade-controls">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8 }}>Assign Clinical Significance Grade:</div>
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
                  <th>LLM English (output)</th>
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
                        {r.source === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : "UMass"}
                      </span>
                    </td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.source_text || r.spanish_source}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.llm_english_translation}</td>
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
    </div>
  );
}
