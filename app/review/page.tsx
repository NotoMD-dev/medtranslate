"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Header from "@/components/Header";
import GradeSelector from "@/components/GradeSelector";
import { CLINICAL_GRADES } from "@/lib/types";
import { exportResultsCSV, downloadFile } from "@/lib/csv";
import {
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  setSessionGradesAsync,
} from "@/lib/session";
import type { JobResults, SentenceMetrics, ClinicalGrade } from "@/lib/types";

type ReviewView = "queue" | "table";

export default function ReviewPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [threshold, setThreshold] = useState(0.4);
  const [thresholdInput, setThresholdInput] = useState("0.4");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [view, setView] = useState<ReviewView>("queue");
  const [jumpInput, setJumpInput] = useState("");

  useEffect(() => {
    getSessionJobResultsAsync().then((persisted) => {
      if (persisted) setJobResults(persisted);
    });
    getSessionGradesAsync().then((persistedGrades) => {
      if (persistedGrades) setGrades(persistedGrades);
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
    if (!jobResults) return;
    const csv = exportResultsCSV(jobResults.sentence_metrics, grades);
    downloadFile(csv, "medtranslate_results.csv");
  }, [jobResults, grades]);

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

  const currentPair: SentenceMetrics | null = flagged[currentIndex] ?? null;

  const noData = completed.length === 0;

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-[22px] font-semibold text-slate-100">
              Clinical Safety Review
            </h2>
            <p className="text-slate-500 text-[13px] mt-1">
              Review translations flagged by low automated scores. Assign clinical
              significance grades to discrepancies.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex bg-surface-700 rounded-lg p-[2px]">
              <button
                onClick={() => setView("queue")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                  view === "queue"
                    ? "bg-accent-blue text-white"
                    : "text-slate-400 hover:text-slate-200 bg-transparent"
                } border-none`}
              >
                Grading Queue
              </button>
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                  view === "table"
                    ? "bg-accent-blue text-white"
                    : "text-slate-400 hover:text-slate-200 bg-transparent"
                } border-none`}
              >
                Table View
              </button>
            </div>

            <button
              onClick={handleExport}
              disabled={!jobResults || sentences.length === 0}
              className="px-4 py-2 rounded-xl text-slate-200 text-[12px] font-semibold border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Threshold control */}
        <div className="flex items-center gap-3 mb-5 mt-4">
          <label className="text-[12px] text-slate-400 font-semibold">
            METEOR Threshold:
          </label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleThresholdApply()}
            className="w-20 px-2.5 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-slate-200 text-[13px] font-mono"
          />
          <button
            onClick={handleThresholdApply}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-accent-blue border border-accent-blue/30 bg-accent-blue/10 cursor-pointer hover:bg-accent-blue/20"
          >
            Apply
          </button>
          <span className="text-[12px] text-slate-500">
            {flagged.length} pair{flagged.length === 1 ? "" : "s"} below {threshold}
          </span>
        </div>

        {/* Grade summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {CLINICAL_GRADES.map((g, idx) => (
            <div
              key={g.grade}
              className="bg-surface-800 border border-surface-700 rounded-xl p-3 text-center"
            >
              <div
                className="text-2xl font-bold font-mono"
                style={{ color: g.color }}
              >
                {gradeCounts[idx]}
              </div>
              <div className="text-[11px] text-slate-400 font-semibold mt-0.5">
                Grade {g.grade}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {g.label}
              </div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {flagged.length > 0 && (
          <div className="mb-5 bg-surface-800 border border-surface-700 rounded-xl p-3 flex items-center gap-4">
            <div className="text-[13px] text-slate-300 font-semibold whitespace-nowrap">
              {gradedCount} / {flagged.length} graded
            </div>
            <div className="flex-1 h-2 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${flagged.length > 0 ? (gradedCount / flagged.length) * 100 : 0}%`,
                  background: "linear-gradient(135deg, #10b981, #0ea5e9)",
                }}
              />
            </div>
            <div className="text-[12px] text-slate-500 font-mono">
              {flagged.length > 0 ? ((gradedCount / flagged.length) * 100).toFixed(0) : 0}%
            </div>
          </div>
        )}

        {noData ? (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-12 text-center">
            <div className="text-slate-500 text-lg mb-2">Run translations first</div>
            <p className="text-slate-600 text-sm">
              This page will display translation pairs with METEOR scores below
              the configured threshold, ready for physician adjudication. Complete batch
              translations on the Translate tab to populate this view.
            </p>
          </div>
        ) : flagged.length === 0 ? (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-12 text-center">
            <div className="text-slate-500 text-lg mb-2">No pairs below threshold</div>
            <p className="text-slate-600 text-sm">
              No completed translations have a METEOR score below {threshold}.
              Adjust the threshold above to flag more pairs, or all translations
              meet the quality threshold.
            </p>
          </div>
        ) : view === "queue" ? (
          /* ========== GRADING QUEUE VIEW ========== */
          <div>
            {/* Navigation bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-300 border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setCurrentIndex(Math.min(flagged.length - 1, currentIndex + 1))
                  }
                  disabled={currentIndex >= flagged.length - 1}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-300 border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
                >
                  Next
                </button>
                <button
                  onClick={handleSkip}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 cursor-pointer hover:bg-amber-500/20"
                >
                  Skip to Ungraded
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[13px] text-slate-300 font-mono">
                  {currentIndex + 1} / {flagged.length}
                </span>
                <input
                  type="number"
                  min="1"
                  max={flagged.length}
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJump()}
                  placeholder="Jump to #"
                  className="w-24 px-2.5 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-slate-200 text-[12px] font-mono placeholder:text-slate-600"
                />
                <button
                  onClick={handleJump}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-accent-blue border border-accent-blue/30 bg-accent-blue/10 cursor-pointer hover:bg-accent-blue/20"
                >
                  Go
                </button>
              </div>
            </div>

            {/* Current pair detail */}
            {currentPair && (
              <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-6">
                {/* Header row: pair metadata */}
                <div className="flex items-center gap-4 mb-5">
                  <div className="text-sm font-semibold text-slate-100">
                    <span className="font-mono text-accent-blue">{currentPair.pair_id}</span>
                  </div>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-semibold"
                    style={{
                      background:
                        currentPair.source === "ClinSpEn_ClinicalCases"
                          ? "#1e3a5f"
                          : "#3b1f2b",
                      color:
                        currentPair.source === "ClinSpEn_ClinicalCases"
                          ? "#7dd3fc"
                          : "#fda4af",
                    }}
                  >
                    {currentPair.source === "ClinSpEn_ClinicalCases"
                      ? "ClinSpEn"
                      : "UMass"}
                  </span>
                  <span
                    className="text-[12px] font-bold font-mono px-2 py-0.5 rounded"
                    style={{
                      color: "#ef4444",
                      background: "#fef2f2",
                    }}
                  >
                    METEOR {currentPair.meteor?.toFixed(3) ?? "--"}
                  </span>
                  {currentPair.bertscore_f1 != null && (
                    <span className="text-[12px] font-bold font-mono px-2 py-0.5 rounded bg-surface-700 text-slate-300">
                      BERTScore {currentPair.bertscore_f1.toFixed(3)}
                    </span>
                  )}
                  {grades[currentPair.pair_id] != null && (
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded"
                      style={{
                        color: CLINICAL_GRADES[grades[currentPair.pair_id]].color,
                        background: CLINICAL_GRADES[grades[currentPair.pair_id]].bg,
                      }}
                    >
                      Grade {grades[currentPair.pair_id]}
                    </span>
                  )}
                </div>

                {/* Three-column text comparison */}
                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      SPANISH SOURCE
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-64 overflow-auto text-slate-300">
                      {currentPair.spanish_source}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      LLM ENGLISH TRANSLATION
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-64 overflow-auto text-violet-300">
                      {currentPair.llm_english_translation}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      ENGLISH REFERENCE (Gold Standard)
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-64 overflow-auto text-cyan-200">
                      {currentPair.english_reference}
                    </div>
                  </div>
                </div>

                {/* Grading buttons */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-400 font-semibold mb-2">
                      Assign Clinical Significance Grade:
                    </div>
                    <div className="flex gap-2">
                      {CLINICAL_GRADES.map((g) => {
                        const isActive = grades[currentPair.pair_id] === g.grade;
                        return (
                          <button
                            key={g.grade}
                            onClick={() => handleGrade(currentPair.pair_id, g.grade)}
                            title={g.description}
                            className="rounded-lg text-[12px] font-bold transition-all cursor-pointer"
                            style={{
                              padding: "8px 16px",
                              border: isActive
                                ? `2px solid ${g.color}`
                                : "1px solid #334155",
                              background: isActive ? g.bg : "#1e293b",
                              color: isActive ? g.color : "#94a3b8",
                            }}
                          >
                            <div>{g.grade}</div>
                            <div className="text-[9px] font-normal mt-0.5 opacity-80">
                              {g.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Auto-advance after grading */}
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setCurrentIndex(Math.min(flagged.length - 1, currentIndex + 1))
                      }
                      disabled={currentIndex >= flagged.length - 1}
                      className="px-5 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 border-none"
                      style={{
                        background:
                          currentIndex < flagged.length - 1
                            ? "linear-gradient(135deg, #0ea5e9, #6366f1)"
                            : "#334155",
                      }}
                    >
                      Next Pair
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mini table of all flagged pairs for quick jumping */}
            <div className="mt-5 bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-surface-700 text-[11px] text-slate-400 font-semibold">
                All Flagged Pairs (click to jump)
              </div>
              <div className="max-h-[240px] overflow-auto">
                <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="bg-surface-700 sticky top-0 z-10">
                      <th className="px-3 py-2 text-left font-semibold text-slate-400 text-[10px] tracking-wider border-b border-surface-600">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-400 text-[10px] tracking-wider border-b border-surface-600">Pair ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-400 text-[10px] tracking-wider border-b border-surface-600">Source</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-400 text-[10px] tracking-wider border-b border-surface-600">METEOR</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-400 text-[10px] tracking-wider border-b border-surface-600">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((r, i) => (
                      <tr
                        key={`${r.pair_id}-${i}`}
                        onClick={() => setCurrentIndex(i)}
                        className={`cursor-pointer border-b border-surface-700 transition-colors ${
                          currentIndex === i
                            ? "bg-accent-blue/10 border-l-2 border-l-accent-blue"
                            : "hover:bg-surface-700/50"
                        }`}
                      >
                        <td className="px-3 py-1.5 text-slate-500 font-mono text-[10px]">{i + 1}</td>
                        <td className="px-3 py-1.5 text-slate-300 font-mono text-[10px]">{r.pair_id}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                            style={{
                              background: r.source === "ClinSpEn_ClinicalCases" ? "#1e3a5f" : "#3b1f2b",
                              color: r.source === "ClinSpEn_ClinicalCases" ? "#7dd3fc" : "#fda4af",
                            }}
                          >
                            {r.source === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : "UMass"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-red-400 text-[10px]">{r.meteor?.toFixed(3) ?? "--"}</td>
                        <td className="px-3 py-1.5">
                          {grades[r.pair_id] != null ? (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                              style={{
                                color: CLINICAL_GRADES[grades[r.pair_id]].color,
                                background: CLINICAL_GRADES[grades[r.pair_id]].bg,
                              }}
                            >
                              {grades[r.pair_id]}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-[10px]">--</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* ========== TABLE VIEW ========== */
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-700 text-[12px] text-slate-400">
              {flagged.length} flagged pair{flagged.length === 1 ? "" : "s"} (METEOR &lt; {threshold})
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="bg-surface-700 sticky top-0 z-10">
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">#</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">Pair ID</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">Source</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">Spanish (input)</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">LLM English (output)</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">METEOR</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((r, i) => (
                    <tr
                      key={`${r.pair_id}-${i}`}
                      onClick={() => {
                        setCurrentIndex(i);
                        setView("queue");
                      }}
                      className="cursor-pointer border-b border-surface-700 transition-colors hover:bg-surface-700/50"
                    >
                      <td className="px-3.5 py-2.5 text-slate-500 font-mono text-[11px]">{i + 1}</td>
                      <td className="px-3.5 py-2.5 text-slate-300 font-mono text-[11px]">{r.pair_id}</td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded font-semibold"
                          style={{
                            background: r.source === "ClinSpEn_ClinicalCases" ? "#1e3a5f" : "#3b1f2b",
                            color: r.source === "ClinSpEn_ClinicalCases" ? "#7dd3fc" : "#fda4af",
                          }}
                        >
                          {r.source === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : "UMass"}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 max-w-[240px] truncate text-slate-300">{r.spanish_source}</td>
                      <td className="px-3.5 py-2.5 max-w-[240px] truncate text-slate-200">{r.llm_english_translation}</td>
                      <td className="px-3.5 py-2.5 font-mono text-red-400">{r.meteor?.toFixed(3) ?? "--"}</td>
                      <td className="px-3.5 py-2.5">
                        {grades[r.pair_id] != null ? (
                          <span
                            className="text-[11px] font-bold px-2 py-0.5 rounded"
                            style={{
                              color: CLINICAL_GRADES[grades[r.pair_id]].color,
                              background: CLINICAL_GRADES[grades[r.pair_id]].bg,
                            }}
                          >
                            {grades[r.pair_id]}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-[11px]">--</span>
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
    </div>
  );
}
