"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Header from "@/components/Header";
import PairDetail from "@/components/PairDetail";
import { pairsToCSVFile, exportResultsCSV, downloadFile } from "@/lib/csv";
import { submitJob, pollUntilDone, fetchJobResults, pollJobStatus } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import type { JobStatusResponse, JobResults, SentenceMetrics, ClinicalGrade } from "@/lib/types";
import {
  getSessionData,
  getSessionPrompt,
  getSessionJobId,
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  setSessionJobId,
  setSessionJobResultsAsync,
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
  const [computeBertscore, setComputeBertscore] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestResultsRef = useRef<JobResults | null>(null);

  // Restore persisted job results on mount
  useEffect(() => {
    getSessionGradesAsync().then((persistedGrades) => {
      if (persistedGrades) setGrades(persistedGrades);
    });

    // Load results async (IndexedDB first, then localStorage fallback)
    getSessionJobResultsAsync().then((persistedResults) => {
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

      // If there's a running job, resume polling
      const jobId = getSessionJobId();
      if (jobId && (!persistedResults || (persistedResults.status !== "complete" && persistedResults.status !== "failed"))) {
        resumePolling(jobId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumePolling = useCallback(async (jobId: string) => {
    setPageState("running");
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const results = await pollUntilDone(jobId, async (status) => {
        if (controller.signal.aborted) return;
        setJobStatus(status);
        setRowCount(status.total);

        // Fetch partial results for real-time table display
        try {
          const partial = await fetchJobResults(jobId);
          if (partial && partial.sentence_metrics.length > 0) {
            setJobResults(partial);
            latestResultsRef.current = partial;
          }
        } catch {
          // Partial results not yet available — ignore
        }
      }, 2000, controller.signal);

      setJobResults(results);
      latestResultsRef.current = results;
      await setSessionJobResultsAsync(results);
      setPageState(results.status === "complete" ? "complete" : "failed");
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        // User stopped translation — save partial results
        const partial = latestResultsRef.current;
        if (partial && partial.sentence_metrics.length > 0) {
          await setSessionJobResultsAsync(partial);
        }
        setPageState("complete");
        return;
      }
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
    latestResultsRef.current = null;
    setJobStatus(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const csvFile = pairsToCSVFile(data);

      const { job_id } = await submitJob(csvFile, {
        model: "gpt-4o",
        systemPrompt,
        temperature: 0,
        maxTokens: 1024,
        computeBertscore,
      });

      setSessionJobId(job_id);
      setRowCount(data.length);
      setPageState("running");

      const results = await pollUntilDone(job_id, async (status) => {
        if (controller.signal.aborted) return;
        setJobStatus(status);

        // Fetch partial results for real-time table display
        try {
          const partial = await fetchJobResults(job_id);
          if (partial && partial.sentence_metrics.length > 0) {
            setJobResults(partial);
            latestResultsRef.current = partial;
          }
        } catch {
          // Partial results not yet available — ignore
        }
      }, 2000, controller.signal);

      setJobResults(results);
      latestResultsRef.current = results;
      await setSessionJobResultsAsync(results);
      setPageState(results.status === "complete" ? "complete" : "failed");

      if (results.status === "failed") {
        setError("Job failed on the backend. Check server logs for details.");
      }
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        // User stopped translation — save and show partial results
        const partial = latestResultsRef.current;
        if (partial && partial.sentence_metrics.length > 0) {
          await setSessionJobResultsAsync(partial);
        }
        setPageState("complete");
        return;
      }
      setError((err as Error).message);
      setPageState("failed");
    }
  }, [computeBertscore]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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

  // Determine which metric columns to show based on available data
  const hasBertscore = sentences.some((s) => s.bertscore_f1 != null);

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

          <div className="flex items-center gap-3">
            {/* BERTScore toggle */}
            {(pageState === "idle" || pageState === "complete" || pageState === "failed") && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={computeBertscore}
                  onChange={(e) => setComputeBertscore(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 accent-indigo-500"
                />
                <span className="text-[12px] text-slate-400">
                  Include BERTScore
                </span>
                <span className="text-[10px] text-slate-600" title="BERTScore requires ~400MB additional memory and uses a RoBERTa model for semantic similarity scoring.">
                  (resource-intensive)
                </span>
              </label>
            )}

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
              <button
                onClick={handleStop}
                className="px-7 py-2.5 rounded-xl text-sm font-bold border cursor-pointer transition-colors"
                style={{
                  color: pageState === "submitting" ? "#60a5fa" : "#f87171",
                  borderColor: pageState === "submitting" ? "#60a5fa" : "#f87171",
                  background: pageState === "submitting" ? "transparent" : "rgba(248,113,113,0.1)",
                }}
              >
                {pageState === "submitting" ? "Submitting..." : "Stop Translation"}
              </button>
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
            {jobResults.library_versions.bert_score && jobResults.library_versions.bert_score !== "not loaded" && (
              <span>bert-score {jobResults.library_versions.bert_score}</span>
            )}
            {jobResults.library_versions.torch && jobResults.library_versions.torch !== "not loaded" && (
              <span>torch {jobResults.library_versions.torch}</span>
            )}
          </div>
        )}

        {/* Corpus BLEU summary */}
        {jobResults?.corpus_metrics && (
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-semibold tracking-widest mb-1">
                SACREBLEU (OVERALL)
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
                  SACREBLEU (ClinSpEn)
                </div>
                <div className="text-2xl font-mono font-light text-slate-100">
                  {jobResults.corpus_metrics.clinspen.bleu_score.toFixed(2)}
                </div>
              </div>
            )}
            {jobResults.corpus_metrics.umass && (
              <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
                <div className="text-[10px] font-semibold tracking-widest mb-1" style={{ color: "#fda4af" }}>
                  SACREBLEU (UMass)
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
                    {[
                      "#",
                      "Source",
                      "Spanish (input)",
                      "LLM English (output)",
                      "METEOR",
                      ...(hasBertscore ? ["BERTScore"] : []),
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600"
                      >
                        {h}
                      </th>
                    ))}
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

                        {hasBertscore && (
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
                        )}

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
