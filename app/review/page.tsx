"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Header from "@/components/Header";
import GradeSelector from "@/components/GradeSelector";
import { CLINICAL_GRADES } from "@/lib/types";
import { getSessionJobResultsAsync, getSessionGradesAsync, setSessionGrades } from "@/lib/session";
import { exportResultsCSV, downloadFile } from "@/lib/csv";
import type { JobResults, SentenceMetrics, ClinicalGrade } from "@/lib/types";

export default function ReviewPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [threshold, setThreshold] = useState(0.4);
  const [thresholdInput, setThresholdInput] = useState("0.4");
  const [currentIndex, setCurrentIndex] = useState(0);

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

  // Filter pairs below configurable METEOR threshold
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
    (pairId: string, grade: ClinicalGrade) => {
      setGrades((prev) => {
        const next = { ...prev, [pairId]: grade };
        setSessionGrades(next);
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

  const handleExport = useCallback(() => {
    if (!jobResults) return;
    const csv = exportResultsCSV(jobResults.sentence_metrics, grades);
    downloadFile(csv, "medtranslate_results.csv");
  }, [jobResults, grades]);

  // Navigation helpers
  const goTo = useCallback(
    (idx: number) => {
      if (idx >= 0 && idx < flagged.length) setCurrentIndex(idx);
    },
    [flagged.length]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);

  const skipToNextUngraded = useCallback(() => {
    for (let i = currentIndex + 1; i < flagged.length; i++) {
      if (grades[flagged[i].pair_id] == null) {
        setCurrentIndex(i);
        return;
      }
    }
    // Wrap around from start
    for (let i = 0; i < currentIndex; i++) {
      if (grades[flagged[i].pair_id] == null) {
        setCurrentIndex(i);
        return;
      }
    }
  }, [currentIndex, flagged, grades]);

  const current: SentenceMetrics | null = flagged[currentIndex] ?? null;

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[22px] font-semibold text-slate-100">
            Clinical Safety Review
          </h2>
          <button
            onClick={handleExport}
            disabled={!jobResults || sentences.length === 0}
            className="px-5 py-2.5 rounded-xl text-slate-200 text-[13px] font-semibold border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
          >
            Export CSV
          </button>
        </div>
        <p className="text-slate-500 text-[13px] mb-6">
          Review translations flagged by low automated scores. Assign clinical
          significance grades to discrepancies.
        </p>

        {/* Threshold control */}
        <div className="flex items-center gap-3 mb-5">
          <label className="text-[12px] text-slate-400 font-semibold">
            METEOR threshold:
          </label>
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleThresholdApply(); }}
            className="w-20 px-2.5 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-slate-200 text-[13px] font-mono"
          />
          <button
            onClick={handleThresholdApply}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold bg-surface-700 border border-surface-600 text-slate-300 cursor-pointer hover:bg-surface-600"
          >
            Apply
          </button>
          <span className="text-[12px] text-slate-500">
            Showing pairs with METEOR &lt; {threshold} ({flagged.length} of {completed.length} pairs)
          </span>
        </div>

        {/* Progress bar + grade summary */}
        {flagged.length > 0 && (
          <>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex justify-between mb-1 text-[12px]">
                  <span className="text-slate-400 font-semibold">
                    Grading progress
                  </span>
                  <span className="text-slate-300 font-mono">
                    {gradedCount} / {flagged.length} graded
                  </span>
                </div>
                <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${flagged.length > 0 ? (gradedCount / flagged.length) * 100 : 0}%`,
                      background: "linear-gradient(135deg, #10b981, #0ea5e9)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Grade distribution cards */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {CLINICAL_GRADES.map((g, idx) => (
                <div
                  key={g.grade}
                  className="bg-surface-800 border border-surface-700 rounded-xl p-4 text-center"
                >
                  <div
                    className="text-3xl font-bold font-mono"
                    style={{ color: g.color }}
                  >
                    {gradeCounts[idx]}
                  </div>
                  <div className="text-[11px] text-slate-400 font-semibold mt-1">
                    Grade {g.grade}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {g.description}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {flagged.length === 0 ? (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-12 text-center">
            <div className="text-slate-500 text-lg mb-2">
              {completed.length === 0
                ? "Run translations first"
                : "No pairs below threshold"}
            </div>
            <p className="text-slate-600 text-sm">
              {completed.length === 0
                ? "This page will display translation pairs with low METEOR scores, ready for physician adjudication. Complete batch translations on the Translate tab to populate this view."
                : `No translated pairs have a METEOR score below ${threshold}. Try increasing the threshold.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[320px_1fr] gap-5">
            {/* Left: pair list / jump navigation */}
            <div className="bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden flex flex-col" style={{ maxHeight: "620px" }}>
              <div className="px-3.5 py-2.5 border-b border-surface-700 text-[11px] text-slate-400 font-semibold flex items-center justify-between">
                <span>{flagged.length} flagged pairs</span>
                <button
                  onClick={skipToNextUngraded}
                  className="text-[10px] text-accent-blue bg-transparent border-none cursor-pointer hover:underline font-semibold"
                >
                  Next ungraded
                </button>
              </div>
              <div className="overflow-auto flex-1">
                {flagged.map((r, i) => (
                  <div
                    key={`${r.pair_id}-${i}`}
                    onClick={() => setCurrentIndex(i)}
                    className={`px-3.5 py-2 cursor-pointer border-b border-surface-700 transition-colors ${
                      currentIndex === i
                        ? "bg-surface-700"
                        : "hover:bg-surface-700/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-mono text-slate-400">
                        {r.pair_id}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background:
                              r.source === "ClinSpEn_ClinicalCases"
                                ? "#1e3a5f"
                                : "#3b1f2b",
                            color:
                              r.source === "ClinSpEn_ClinicalCases"
                                ? "#7dd3fc"
                                : "#fda4af",
                          }}
                        >
                          {r.source === "ClinSpEn_ClinicalCases"
                            ? "ClinSpEn"
                            : "UMass"}
                        </span>
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
                          <span className="text-[10px] text-slate-600">--</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      METEOR {r.meteor?.toFixed(3) ?? "--"}
                      {" | "}
                      {r.spanish_source.slice(0, 60)}
                      {r.spanish_source.length > 60 ? "..." : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: focused grading panel */}
            {current && (
              <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-6 flex flex-col" style={{ maxHeight: "620px" }}>
                {/* Header with navigation */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      <span className="font-mono text-accent-blue">{current.pair_id}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded font-semibold"
                        style={{
                          background:
                            current.source === "ClinSpEn_ClinicalCases"
                              ? "#1e3a5f"
                              : "#3b1f2b",
                          color:
                            current.source === "ClinSpEn_ClinicalCases"
                              ? "#7dd3fc"
                              : "#fda4af",
                        }}
                      >
                        {current.source === "ClinSpEn_ClinicalCases"
                          ? "ClinSpEn"
                          : "UMass"}
                      </span>
                      <span
                        className="text-[12px] font-mono font-semibold"
                        style={{
                          color: (current.meteor ?? 0) > 0.3 ? "#f59e0b" : "#ef4444",
                        }}
                      >
                        METEOR {current.meteor?.toFixed(3) ?? "--"}
                      </span>
                      {current.bertscore_f1 != null && (
                        <span className="text-[12px] font-mono text-slate-400">
                          BERTScore {current.bertscore_f1.toFixed(3)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={goPrev}
                      disabled={currentIndex <= 0}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-surface-700 border border-surface-600 text-slate-300 cursor-pointer hover:bg-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <span className="text-[12px] text-slate-400 font-mono min-w-[60px] text-center">
                      {currentIndex + 1} / {flagged.length}
                    </span>
                    <button
                      onClick={goNext}
                      disabled={currentIndex >= flagged.length - 1}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-surface-700 border border-surface-600 text-slate-300 cursor-pointer hover:bg-surface-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                    <button
                      onClick={skipToNextUngraded}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-surface-700 border border-accent-blue/30 text-accent-blue cursor-pointer hover:bg-surface-600"
                    >
                      Skip
                    </button>
                  </div>
                </div>

                {/* Three-column text comparison */}
                <div className="grid grid-cols-3 gap-3 mb-4 flex-1 overflow-hidden">
                  <div className="flex flex-col min-h-0">
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      SPANISH SOURCE
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3 text-[13px] leading-relaxed overflow-auto flex-1 text-slate-300">
                      {current.spanish_source}
                    </div>
                  </div>
                  <div className="flex flex-col min-h-0">
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      LLM ENGLISH TRANSLATION
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3 text-[13px] leading-relaxed overflow-auto flex-1 text-violet-300">
                      {current.llm_english_translation}
                    </div>
                  </div>
                  <div className="flex flex-col min-h-0">
                    <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
                      ENGLISH REFERENCE (Gold Standard)
                    </div>
                    <div className="bg-surface-700 rounded-lg p-3 text-[13px] leading-relaxed overflow-auto flex-1 text-cyan-200">
                      {current.english_reference}
                    </div>
                  </div>
                </div>

                {/* Grade selector */}
                <div className="flex items-center justify-between pt-3 border-t border-surface-700">
                  <GradeSelector
                    value={grades[current.pair_id] ?? null}
                    onChange={(grade) => {
                      handleGrade(current.pair_id, grade);
                      // Auto-advance to next ungraded after grading
                      if (currentIndex < flagged.length - 1) {
                        // Slight delay so the user sees the grade applied
                        setTimeout(() => {
                          // Find next ungraded from current position
                          for (let i = currentIndex + 1; i < flagged.length; i++) {
                            if (grades[flagged[i].pair_id] == null && flagged[i].pair_id !== current.pair_id) {
                              setCurrentIndex(i);
                              return;
                            }
                          }
                          // If none found after, just go next
                          setCurrentIndex((prev) => Math.min(prev + 1, flagged.length - 1));
                        }, 150);
                      }
                    }}
                  />
                  <span className="text-[11px] text-slate-500">
                    {grades[current.pair_id] != null
                      ? `Graded: ${CLINICAL_GRADES[grades[current.pair_id]].label}`
                      : "Not yet graded"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
