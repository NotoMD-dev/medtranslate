"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Header from "@/components/Header";
import StatusPill from "@/components/StatusPill";
import PairDetail from "@/components/PairDetail";
import { computeAllMetrics } from "@/lib/metrics";
import { exportResultsCSV, downloadFile } from "@/lib/csv";
import type { TranslationResult, ClinicalGrade } from "@/lib/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import {
  getSessionData,
  getSessionPrompt,
  getSessionResults,
  setSessionResults,
} from "@/lib/session";

export default function TranslatePage() {
  const [results, setResults] = useState<TranslationResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const abortRef = useRef(false);

  // ✅ FIXED: Hydrate ONCE and never overwrite valid persisted results
  useEffect(() => {
    const persisted = getSessionResults();

    if (persisted && persisted.length > 0) {
      setResults(persisted);

      const done = persisted.filter(
        (r) => r._status === "complete" || r._status === "error"
      ).length;

      setProgress({ done, total: persisted.length });
      return;
    }

    const data = getSessionData();
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
  }, []);

  // Persist results whenever they change
  useEffect(() => {
    if (results.length > 0) {
      setSessionResults(results);
    }
  }, [results]);

  const runTranslations = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    const total = results.length;
    setProgress({ done: 0, total });

    const systemPrompt =
      getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;

      const row = results[i];

      if (row._status === "complete") {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        continue;
      }

      // Mark translating
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
            model: "gpt-4o",
          }),
        });

        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        const translation = data.translation;

        // Mark scoring
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

        {/* Rest of your component remains unchanged */}
      </div>
    </div>
  );
}