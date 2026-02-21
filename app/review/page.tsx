"use client";

import Header from "@/components/Header";
import { CLINICAL_GRADES } from "@/lib/types";

export default function ReviewPage() {
  // In production, this would share state with the Translate page via context/store
  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-[1200px] mx-auto px-8 py-7">
        <h2 className="text-[22px] font-semibold text-slate-100 mb-2">
          Clinical Safety Review
        </h2>
        <p className="text-slate-500 text-[13px] mb-6">
          Review translations flagged by low automated scores. Assign clinical
          significance grades to discrepancies.
        </p>

        {/* Grade summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {CLINICAL_GRADES.map((g) => (
            <div
              key={g.grade}
              className="bg-surface-800 border border-surface-700 rounded-xl p-4 text-center"
            >
              <div
                className="text-3xl font-bold font-mono"
                style={{ color: g.color }}
              >
                --
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

        <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-12 text-center">
          <div className="text-slate-500 text-lg mb-2">
            Run translations first
          </div>
          <p className="text-slate-600 text-sm">
            This page will display translation pairs with BLEU scores below 0.4,
            ready for physician adjudication. Complete batch translations on the
            Translate tab to populate this view.
          </p>
        </div>
      </div>
    </div>
  );
}
