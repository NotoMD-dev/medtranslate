"use client";

import Header from "@/components/Header";
import MetricsCard from "@/components/MetricsCard";
import { CLINICAL_GRADES } from "@/lib/types";

export default function MetricsPage() {
  // In production, shared state via context/store
  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <h2 className="text-[22px] font-semibold text-slate-100 mb-6">
          Aggregate Metrics
        </h2>

        {/* Metric cards */}
        <div className="grid grid-cols-3 gap-4 mb-7">
          <MetricsCard
            label="BLEU"
            value={null}
            description="N-gram overlap"
            count={0}
          />
          <MetricsCard
            label="METEOR"
            value={null}
            description="Synonym-aware matching"
            count={0}
          />
          <MetricsCard
            label="BERTProxy"
            value={null}
            description="Semantic similarity"
            count={0}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Clinical grade distribution */}
          <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
            <div className="text-sm font-semibold text-slate-100 mb-4">
              Clinical Significance Distribution
            </div>
            {CLINICAL_GRADES.map((g) => (
              <div key={g.grade} className="mb-3">
                <div className="flex justify-between mb-1">
                  <span className="text-[12px] text-slate-400">
                    Grade {g.grade}: {g.label}
                  </span>
                  <span
                    className="text-[12px] font-mono"
                    style={{ color: g.color }}
                  >
                    -- (--%)
                  </span>
                </div>
                <div className="h-2 bg-surface-700 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{ width: "0%", background: g.color }}
                  />
                </div>
              </div>
            ))}
            <div className="text-slate-600 text-[13px] mt-2">
              No pairs graded yet
            </div>
          </div>

          {/* Source comparison */}
          <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
            <div className="text-sm font-semibold text-slate-100 mb-4">
              Performance by Source
            </div>
            {[
              {
                label: "ClinSpEn (Case Reports)",
                color: "#7dd3fc",
              },
              {
                label: "UMass (EHR Notes)",
                color: "#fda4af",
              },
            ].map((src) => (
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
                      --
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500">METEOR</span>{" "}
                    <span className="text-base font-mono text-slate-100 ml-1">
                      --
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500">n</span>{" "}
                    <span className="text-base font-mono text-slate-400 ml-1">
                      0
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
