"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import MetricsCard from "@/components/MetricsCard";
import { CLINICAL_GRADES } from "@/lib/types";
import { summarizeMetric } from "@/lib/metrics";
import type { TranslationResult } from "@/lib/types";
import { getSessionResults } from "@/lib/session";

export default function MetricsPage() {
  const [results, setResults] = useState<TranslationResult[]>([]);

  // Load persisted results from globalThis
  useEffect(() => {
    const persisted = getSessionResults();
    if (persisted && persisted.length > 0) {
      setResults(persisted);
    }
  }, []);

  const completed = results.filter((r) => r._status === "complete");

  // Aggregate metric values from completed results
  const bleuValues = completed
    .map((r) => r._bleu)
    .filter((v): v is number => v != null);
  const meteorValues = completed
    .map((r) => r._meteor)
    .filter((v): v is number => v != null);
  const bertValues = completed
    .map((r) => r._bert_proxy)
    .filter((v): v is number => v != null);

  const bleuSummary = summarizeMetric(bleuValues);
  const meteorSummary = summarizeMetric(meteorValues);
  const bertSummary = summarizeMetric(bertValues);

  // Clinical grade distribution
  const graded = completed.filter((r) => r._clinical_grade != null);
  const gradeCounts = CLINICAL_GRADES.map(
    (g) => graded.filter((r) => r._clinical_grade === g.grade).length
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
    const srcBleu = srcCompleted
      .map((r) => r._bleu)
      .filter((v): v is number => v != null);
    const srcMeteor = srcCompleted
      .map((r) => r._meteor)
      .filter((v): v is number => v != null);
    return {
      ...src,
      count: srcCompleted.length,
      bleu: srcBleu.length > 0 ? summarizeMetric(srcBleu).mean : null,
      meteor: srcMeteor.length > 0 ? summarizeMetric(srcMeteor).mean : null,
    };
  });

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <h2 className="text-[22px] font-semibold text-slate-100 mb-1">
          Aggregate Metrics
        </h2>
        {completed.length > 0 && (
          <p className="text-slate-500 text-[13px] mb-6">
            {completed.length} of {results.length} translations completed
          </p>
        )}
        {completed.length === 0 && (
          <p className="text-slate-500 text-[13px] mb-6">
            Run translations first to see metrics here.
          </p>
        )}

        {/* Metric cards */}
        <div className="grid grid-cols-3 gap-4 mb-7">
          <MetricsCard
            label="BLEU"
            value={bleuValues.length > 0 ? bleuSummary.mean : null}
            description="N-gram overlap"
            count={bleuValues.length}
          />
          <MetricsCard
            label="METEOR"
            value={meteorValues.length > 0 ? meteorSummary.mean : null}
            description="Synonym-aware matching"
            count={meteorValues.length}
          />
          <MetricsCard
            label="BERTProxy"
            value={bertValues.length > 0 ? bertSummary.mean : null}
            description="Semantic similarity"
            count={bertValues.length}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Clinical grade distribution */}
          <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
            <div className="text-sm font-semibold text-slate-100 mb-4">
              Clinical Significance Distribution
            </div>
            {CLINICAL_GRADES.map((g, i) => {
              const count = gradeCounts[i];
              const pct = totalGraded > 0 ? (count / totalGraded) * 100 : 0;
              return (
                <div key={g.grade} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[12px] text-slate-400">
                      Grade {g.grade}: {g.label}
                    </span>
                    <span
                      className="text-[12px] font-mono"
                      style={{ color: g.color }}
                    >
                      {totalGraded > 0
                        ? `${count} (${pct.toFixed(0)}%)`
                        : "-- (--)"}
                    </span>
                  </div>
                  <div className="h-2 bg-surface-700 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{ width: `${pct}%`, background: g.color }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="text-slate-600 text-[13px] mt-2">
              {totalGraded > 0
                ? `${totalGraded} pair${totalGraded !== 1 ? "s" : ""} graded`
                : "No pairs graded yet"}
            </div>
          </div>

          {/* Source comparison */}
          <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
            <div className="text-sm font-semibold text-slate-100 mb-4">
              Performance by Source
            </div>
            {sourceMetrics.map((src) => (
              <div
                key={src.label}
                className="mb-4 bg-surface-700 rounded-[10px] p-4"
              >
                <div
                  className="text-[12px] font-semibold mb-2"
                  style={{ color: src.color }}
                >
                  {src.label}
                </div>
                <div className="flex gap-5">
                  <div>
                    <span className="text-[10px] text-slate-500">BLEU</span>{" "}
                    <span className="text-base font-mono text-slate-100 ml-1">
                      {src.bleu != null ? src.bleu.toFixed(3) : "--"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500">METEOR</span>{" "}
                    <span className="text-base font-mono text-slate-100 ml-1">
                      {src.meteor != null ? src.meteor.toFixed(3) : "--"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500">n</span>{" "}
                    <span className="text-base font-mono text-slate-400 ml-1">
                      {src.count}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
