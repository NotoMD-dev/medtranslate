"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import MetricsCard from "@/components/MetricsCard";
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

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <h2 className="text-[22px] font-semibold text-slate-100 mb-1">
          Aggregate Metrics
        </h2>
        {completed.length > 0 && (
          <p className="text-slate-500 text-[13px] mb-6">
            {completed.length} of {sentences.length} translations completed
          </p>
        )}
        {completed.length === 0 && (
          <p className="text-slate-500 text-[13px] mb-6">
            Run translations first to see metrics here.
          </p>
        )}

        {/* Corpus SacreBLEU (from backend sacrebleu) */}
        {corpusBleu && (
          <div className="mb-7">
            <div className="text-[12px] font-semibold text-slate-400 tracking-wider mb-3">
              SACREBLEU (CORPUS-LEVEL)
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
                <div className="text-[11px] text-slate-500 font-semibold tracking-widest mb-2">
                  OVERALL
                </div>
                <div className="text-4xl font-light font-mono text-slate-100 tracking-tight">
                  {corpusBleu.overall.bleu_score.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-600 mt-2 font-mono break-all">
                  {corpusBleu.overall.bleu_signature}
                </div>
              </div>
              {corpusBleu.clinspen && (
                <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
                  <div className="text-[11px] font-semibold tracking-widest mb-2" style={{ color: "#7dd3fc" }}>
                    ClinSpEn
                  </div>
                  <div className="text-4xl font-light font-mono text-slate-100 tracking-tight">
                    {corpusBleu.clinspen.bleu_score.toFixed(2)}
                  </div>
                </div>
              )}
              {corpusBleu.umass && (
                <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
                  <div className="text-[11px] font-semibold tracking-widest mb-2" style={{ color: "#fda4af" }}>
                    UMass
                  </div>
                  <div className="text-4xl font-light font-mono text-slate-100 tracking-tight">
                    {corpusBleu.umass.bleu_score.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sentence-level metric cards */}
        <div className={`grid gap-4 mb-7 ${hasBertscore ? "grid-cols-2" : "grid-cols-1 max-w-md"}`}>
          <MetricsCard
            label="METEOR"
            value={meteorValues.length > 0 ? meteorSummary.mean : null}
            description="WordNet + stemming (NLTK)"
            count={meteorValues.length}
          />
          {hasBertscore && (
            <MetricsCard
              label="BERTScore F1"
              value={bertSummary.mean}
              description="Rescaled with baseline (roberta-base)"
              count={bertValues.length}
            />
          )}
        </div>

        {!hasBertscore && completed.length > 0 && (
          <div className="mb-7 p-3 bg-surface-800 border border-surface-700 rounded-xl text-slate-500 text-[12px]">
            BERTScore was not computed for this run. To include it, enable the &quot;Include BERTScore&quot; toggle on the Translate page before running.
          </div>
        )}

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
                    <span className="text-[10px] text-slate-500">METEOR</span>{" "}
                    <span className="text-base font-mono text-slate-100 ml-1">
                      {src.meteor != null ? src.meteor.toFixed(3) : "--"}
                    </span>
                  </div>
                  {hasBertscore && (
                    <div>
                      <span className="text-[10px] text-slate-500">BERTScore</span>{" "}
                      <span className="text-base font-mono text-slate-100 ml-1">
                        {src.bert != null ? src.bert.toFixed(3) : "--"}
                      </span>
                    </div>
                  )}
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

        {/* Library versions */}
        {jobResults?.library_versions && (
          <div className="mt-6 bg-surface-800 border border-surface-700 rounded-xl p-4">
            <div className="text-[11px] text-slate-500 font-semibold tracking-widest mb-2">
              LIBRARY VERSIONS (REPRODUCIBILITY)
            </div>
            <div className="flex gap-6 text-[12px] text-slate-400 font-mono">
              <span>sacrebleu: {jobResults.library_versions.sacrebleu}</span>
              <span>nltk: {jobResults.library_versions.nltk}</span>
              {jobResults.library_versions.bert_score && jobResults.library_versions.bert_score !== "not loaded" && (
                <span>bert-score: {jobResults.library_versions.bert_score}</span>
              )}
              {jobResults.library_versions.torch && jobResults.library_versions.torch !== "not loaded" && (
                <span>torch: {jobResults.library_versions.torch}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
