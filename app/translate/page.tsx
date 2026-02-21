"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Header from "@/components/Header";
import PairDetail from "@/components/PairDetail";
import { pairsToCSVFile, exportResultsCSV, downloadFile } from "@/lib/csv";
import { submitJob, pollUntilDone, pollJobStatus } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import type { JobStatusResponse, JobResults, SentenceMetrics, ClinicalGrade } from "@/lib/types";
import {
  getSessionData,
  getSessionPrompt,
  getSessionJobId,
  getSessionJobResults,
  getSessionGrades,
  setSessionJobId,
  setSessionJobResults,
  setSessionGrades,
} from "@/lib/session";

type PageState = "idle" | "submitting" | "running" | "complete" | "failed";

export default function TranslatePage() {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [rowCount, setRowCount] = useState(0);
  const abortRef = useRef(false);

  // Restore persisted job results on mount
  useEffect(() => {
    const persistedResults = getSessionJobResults();
    const persistedGrades = getSessionGrades();

    if (persistedResults && persistedResults.status === "complete") {
      setJobResults(persistedResults);
      setPageState("complete");
      setRowCount(persistedResults.sentence_metrics.length);
    } else if (persistedResults && persistedResults.status === "failed") {
      setJobResults(persistedResults);
      setPageState("failed");
    } else {
      const data = getSessionData();
      if (data) setRowCount(data.length);
    }

    if (persistedGrades) {
      setGrades(persistedGrades);
    }

    // If there's a running job, resume polling
    const jobId = getSessionJobId();
    if (jobId && (!persistedResults || (persistedResults.status !== "complete" && persistedResults.status !== "failed"))) {
      resumePolling(jobId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumePolling = useCallback(async (jobId: string) => {
    setPageState("running");
    abortRef.current = false;

    try {
      const results = await pollUntilDone(jobId, (status) => {
        if (abortRef.current) return;
        setJobStatus(status);
        setRowCount(status.total);
      });

      setJobResults(results);
      setSessionJobResults(results);
      setPageState(results.status === "complete" ? "complete" : "failed");
    } catch (err) {
      setError((err as Error).message);
      setPageState("failed");
    }
  }, []);

  const handleRun = useCallback(async () => {
    const data = getSessionData();
    if (!data || data.length === 0) {
      setError("No dataset loaded. Go to Upload to load your CSV first.");
      return;
    }

    setPageState("submitting");
    setError(null);
    setJobResults(null);
    setJobStatus(null);
    abortRef.current = false;

    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const csvFile = pairsToCSVFile(data);

      const { job_id } = await submitJob(csvFile, {
        model: "gpt-4o",
        systemPrompt,
        temperature: 0,
        maxTokens: 1024,
      });

      setSessionJobId(job_id);
      setRowCount(data.length);
      setPageState("running");

      const results = await pollUntilDone(job_id, (status) => {
        if (abortRef.current) return;
        setJobStatus(status);
      });

      setJobResults(results);
      setSessionJobResults(results);
      setPageState(results.status === "complete" ? "complete" : "failed");

      if (results.status === "failed") {
        setError("Job failed on the backend. Check server logs for details.");
      }
    } catch (err) {
      setError((err as Error).message);
      setPageState("failed");
    }
  }, []);

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

  const handleExport = useCallback(() => {
    if (!jobResults) return;
    const csv = exportResultsCSV(jobResults.sentence_metrics, grades);
    downloadFile(csv, "medtranslate_results.csv");
  }, [jobResults, grades]);

  const sentences = jobResults?.sentence_metrics ?? [];
  const completedCount = sentences.filter((s) => s.llm_english_translation && !s.error).length;
  const errorCount = sentences.filter((s) => s.error).length;

  const progress = jobStatus
    ? {
        done: jobStatus.translated + jobStatus.scored,
        total: jobStatus.total * 2, // translation + scoring phases
        pct: jobStatus.total > 0
          ? ((jobStatus.translated / jobStatus.total) * 100)
          : 0,
      }
    : { done: 0, total: 0, pct: 0 };

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">

        {/* Controls */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-semibold text-slate-100">
              Batch Translation
            </h2>
            <p className="text-slate-500 text-[13px] mt-1">
              {rowCount} pairs
              {pageState === "complete" && ` | ${completedCount} completed | ${errorCount} errors`}
              {pageState === "running" && jobStatus && ` | ${jobStatus.translated} translated`}
            </p>
          </div>

          <div className="flex gap-2.5">
            {pageState === "idle" || pageState === "complete" || pageState === "failed" ? (
              <button
                onClick={handleRun}
                disabled={rowCount === 0}
                className="px-7 py-2.5 rounded-xl text-white text-sm font-bold border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background:
                    rowCount > 0
                      ? "linear-gradient(135deg, #0ea5e9, #6366f1)"
                      : "#334155",
                }}
              >
                {pageState === "complete" || pageState === "failed"
                  ? "Re-run Translations"
                  : "Run Translations"}
              </button>
            ) : (
              <div className="px-7 py-2.5 rounded-xl text-accent-blue text-sm font-bold border border-accent-blue bg-transparent">
                {pageState === "submitting" ? "Submitting..." : "Running..."}
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={!jobResults || sentences.length === 0}
              className="px-5 py-2.5 rounded-xl text-slate-200 text-[13px] font-semibold border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {(pageState === "running" || pageState === "submitting") && (
          <div className="mb-5">
            <div className="flex justify-between mb-1.5 text-[12px] text-slate-400">
              <span>
                {jobStatus
                  ? `${jobStatus.translated} of ${jobStatus.total} translated`
                  : "Submitting job..."}
              </span>
              <span>
                {progress.pct.toFixed(1)}%
              </span>
            </div>

            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 progress-shimmer"
                style={{
                  width: `${progress.pct}%`,
                }}
              />
            </div>

            {jobStatus && jobStatus.scored > 0 && (
              <div className="text-[11px] text-slate-500 mt-1">
                {jobStatus.scored} metrics computed
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-5 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty State */}
        {rowCount === 0 && pageState === "idle" && (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-16 text-center">
            <div className="text-slate-500 text-lg mb-2">No dataset loaded</div>
            <p className="text-slate-600 text-sm">
              Go to the Upload tab to load your CSV or XLSX first.
            </p>
          </div>
        )}

        {/* Library versions badge */}
        {jobResults?.library_versions && (
          <div className="mb-5 bg-surface-800 border border-surface-700 rounded-xl p-3 flex gap-4 text-[11px] text-slate-500">
            <span>sacrebleu {jobResults.library_versions.sacrebleu}</span>
            <span>nltk {jobResults.library_versions.nltk}</span>
            <span>bert-score {jobResults.library_versions.bert_score}</span>
            <span>torch {jobResults.library_versions.torch}</span>
          </div>
        )}

        {/* Corpus BLEU summary */}
        {jobResults?.corpus_metrics && (
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-semibold tracking-widest mb-1">
                CORPUS BLEU (OVERALL)
              </div>
              <div className="text-2xl font-mono font-light text-slate-100">
                {jobResults.corpus_metrics.overall.bleu_score.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-600 mt-1 font-mono break-all">
                {jobResults.corpus_metrics.overall.bleu_signature}
              </div>
            </div>
            {jobResults.corpus_metrics.clinspen && (
              <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
                <div className="text-[10px] font-semibold tracking-widest mb-1" style={{ color: "#7dd3fc" }}>
                  CORPUS BLEU (ClinSpEn)
                </div>
                <div className="text-2xl font-mono font-light text-slate-100">
                  {jobResults.corpus_metrics.clinspen.bleu_score.toFixed(2)}
                </div>
              </div>
            )}
            {jobResults.corpus_metrics.umass && (
              <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
                <div className="text-[10px] font-semibold tracking-widest mb-1" style={{ color: "#fda4af" }}>
                  CORPUS BLEU (UMass)
                </div>
                <div className="text-2xl font-mono font-light text-slate-100">
                  {jobResults.corpus_metrics.umass.bleu_score.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results Table */}
        {sentences.length > 0 && (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="bg-surface-700 sticky top-0 z-10">
                    {["#", "Source", "Spanish (input)", "LLM English (output)", "METEOR", "BERTScore", "Status"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>

                <tbody>
                  {sentences.slice(0, 200).map((r, i) => {
                    const hasError = !!r.error;
                    const hasTranslation = !!r.llm_english_translation;
                    return (
                      <tr
                        key={`${r.pair_id}-${i}`}
                        onClick={() => setSelectedRow(i)}
                        className={`cursor-pointer border-b border-surface-700 transition-colors ${
                          selectedRow === i
                            ? "bg-surface-700"
                            : "hover:bg-surface-700/50"
                        }`}
                      >
                        <td className="px-3.5 py-2.5 text-slate-500 font-mono text-[11px]">
                          {i + 1}
                        </td>

                        <td className="px-3.5 py-2.5">
                          <span
                            className="text-[10px] px-2 py-0.5 rounded font-semibold"
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
                        </td>

                        <td className="px-3.5 py-2.5 max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-slate-300">
                          {r.spanish_source}
                        </td>

                        <td
                          className={`px-3.5 py-2.5 max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap ${
                            hasTranslation
                              ? "text-slate-200"
                              : "text-slate-600"
                          }`}
                        >
                          {r.llm_english_translation || (hasError ? "Failed" : "...")}
                        </td>

                        <td
                          className="px-3.5 py-2.5 font-mono text-[12px]"
                          style={{
                            color:
                              r.meteor != null
                                ? r.meteor > 0.5
                                  ? "#10b981"
                                  : r.meteor > 0.2
                                  ? "#f59e0b"
                                  : "#ef4444"
                                : "#475569",
                          }}
                        >
                          {r.meteor != null ? r.meteor.toFixed(3) : "--"}
                        </td>

                        <td
                          className="px-3.5 py-2.5 font-mono text-[12px]"
                          style={{
                            color:
                              r.bertscore_f1 != null
                                ? r.bertscore_f1 > 0.5
                                  ? "#10b981"
                                  : r.bertscore_f1 > 0.2
                                  ? "#f59e0b"
                                  : "#ef4444"
                                : "#475569",
                          }}
                        >
                          {r.bertscore_f1 != null ? r.bertscore_f1.toFixed(3) : "--"}
                        </td>

                        <td className="px-3.5 py-2.5">
                          <span
                            className="inline-block rounded-full text-[11px] font-semibold tracking-wide px-2.5 py-0.5"
                            style={{
                              background: hasError
                                ? "#fee2e2"
                                : hasTranslation
                                ? "#dcfce7"
                                : "#f1f5f9",
                              color: hasError
                                ? "#dc2626"
                                : hasTranslation
                                ? "#16a34a"
                                : "#64748b",
                            }}
                          >
                            {hasError ? "Error" : hasTranslation ? "Complete" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {sentences.length > 200 && (
                <div className="p-3.5 text-center text-slate-500 text-[12px]">
                  Showing first 200 of {sentences.length} rows
                </div>
              )}
            </div>
          </div>
        )}

        {selectedRow != null && sentences[selectedRow] && (
          <div className="mt-5">
            <PairDetail
              sentence={sentences[selectedRow]}
              grade={grades[sentences[selectedRow].pair_id] ?? null}
              onGrade={(grade) => handleGrade(sentences[selectedRow].pair_id, grade)}
              onClose={() => setSelectedRow(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
