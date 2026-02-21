"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Header from "@/components/Header";
import StatusPill from "@/components/StatusPill";
import PairDetail from "@/components/PairDetail";
import { computeAllMetrics } from "@/lib/metrics";
import { exportResultsCSV, downloadFile } from "@/lib/csv";
import type { TranslationResult, ClinicalGrade } from "@/lib/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";

export default function TranslatePage() {
  const [results, setResults] = useState<TranslationResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const abortRef = useRef(false);

  // Load data from global state on mount — prefer persisted results
  useEffect(() => {
    if (results.length > 0) return;

    const persisted = globalThis.__medtranslate_results;
    if (persisted && persisted.length > 0) {
      setResults(persisted);
      // Restore progress counts
      const done = persisted.filter(
        (r) => r._status === "complete" || r._status === "error"
      ).length;
      setProgress({ done, total: persisted.length });
      return;
    }

    const data = globalThis.__medtranslate_data;
    if (data && data.length > 0) {
      setResults(
        data.map((r, i) => ({
          ...r,
          _index: i,
          _status: "pending" as const,
          _bleu: null,
          _meteor: null,
          _bert_proxy: null,
          _clinical_grade: null,
        }))
      );
    }
  }, [results.length]);

  // Persist results to globalThis whenever they change
  useEffect(() => {
    if (results.length > 0) {
      globalThis.__medtranslate_results = results;
    }
  }, [results]);

  const runTranslations = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    const total = results.length;
    setProgress({ done: 0, total });

    const systemPrompt =
      globalThis.__medtranslate_prompt || DEFAULT_SYSTEM_PROMPT;

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;

      const row = results[i];
      if (row._status === "complete") {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        continue;
      }

      // Mark as translating
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], _status: "translating" };
        return next;
      });

      try {
        const resp = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: row.spanish_source,
            systemPrompt,
            model: "gpt-4o", // configurable
          }),
        });

        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        const translation = data.translation;

        // Mark as scoring
        setResults((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            _status: "scoring",
            llm_english_translation: translation,
          };
          return next;
        });

        // Compute metrics
        const ref = row.english_reference;
        const metrics = ref
          ? computeAllMetrics(translation, ref)
          : { bleu: null, meteor: null, bert_proxy: null };

        setResults((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            _status: "complete",
            _bleu: metrics.bleu,
            _meteor: metrics.meteor,
            _bert_proxy: metrics.bert_proxy,
          };
          return next;
        });
      } catch (err) {
        setResults((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            _status: "error",
            _error_message: (err as Error).message,
          };
          return next;
        });
      }

      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setIsRunning(false);
  }, [results]);

  const handleGrade = useCallback(
    (idx: number, grade: ClinicalGrade) => {
      setResults((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], _clinical_grade: grade };
        return next;
      });
    },
    []
  );

  const handleExport = useCallback(() => {
    const csv = exportResultsCSV(results);
    downloadFile(csv, "medtranslate_results.csv");
  }, [results]);

  const completed = results.filter((r) => r._status === "complete");
  const errors = results.filter((r) => r._status === "error");

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
              {results.length} pairs | {completed.length} completed |{" "}
              {errors.length} errors
            </p>
          </div>
          <div className="flex gap-2.5">
            {!isRunning ? (
              <button
                onClick={runTranslations}
                disabled={results.length === 0}
                className="px-7 py-2.5 rounded-xl text-white text-sm font-bold border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background:
                    results.length > 0
                      ? "linear-gradient(135deg, #0ea5e9, #6366f1)"
                      : "#334155",
                }}
              >
                Run Translations
              </button>
            ) : (
              <button
                onClick={() => (abortRef.current = true)}
                className="px-7 py-2.5 rounded-xl text-red-400 text-sm font-bold border border-red-500 bg-transparent cursor-pointer hover:bg-red-500/10"
              >
                Stop
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={completed.length === 0}
              className="px-5 py-2.5 rounded-xl text-slate-200 text-[13px] font-semibold border border-surface-600 bg-surface-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-600"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {progress.total > 0 && (
          <div className="mb-5">
            <div className="flex justify-between mb-1.5 text-[12px] text-slate-400">
              <span>
                {progress.done} of {progress.total}
              </span>
              <span>
                {((progress.done / progress.total) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isRunning ? "progress-shimmer" : ""
                }`}
                style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                  background: isRunning
                    ? undefined
                    : "linear-gradient(90deg, #0ea5e9, #6366f1)",
                }}
              />
            </div>
          </div>
        )}

        {/* No data state */}
        {results.length === 0 && (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-16 text-center">
            <div className="text-slate-500 text-lg mb-2">No dataset loaded</div>
            <p className="text-slate-600 text-sm">
              Go to the Upload tab to load your CSV or XLSX first.
            </p>
          </div>
        )}

        {/* Results table */}
        {results.length > 0 && (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="bg-surface-700 sticky top-0 z-10">
                    {["#", "Source", "Spanish (input)", "LLM English (output)", "BLEU", "Status"].map(
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
                  {results.slice(0, 200).map((r, i) => (
                    <tr
                      key={i}
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
                      <td className="px-3.5 py-2.5 max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap text-slate-300">
                        {r.spanish_source}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap ${
                          r.llm_english_translation
                            ? "text-slate-200"
                            : "text-slate-600"
                        }`}
                      >
                        {r.llm_english_translation || "..."}
                      </td>
                      <td
                        className="px-3.5 py-2.5 font-mono text-[12px]"
                        style={{
                          color:
                            r._bleu != null
                              ? r._bleu > 0.5
                                ? "#10b981"
                                : r._bleu > 0.2
                                ? "#f59e0b"
                                : "#ef4444"
                              : "#475569",
                        }}
                      >
                        {r._bleu != null ? r._bleu.toFixed(3) : "--"}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <StatusPill status={r._status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 200 && (
                <div className="p-3.5 text-center text-slate-500 text-[12px]">
                  Showing first 200 of {results.length} rows
                </div>
              )}
            </div>
          </div>
        )}

        {/* Detail panel */}
        {selectedRow != null && results[selectedRow] && (
          <div className="mt-5">
            <PairDetail
              result={results[selectedRow]}
              onGrade={(grade) => handleGrade(selectedRow, grade)}
              onClose={() => setSelectedRow(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
