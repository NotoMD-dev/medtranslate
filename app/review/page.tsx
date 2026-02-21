"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { CLINICAL_GRADES } from "@/lib/types";
import { getSessionResults } from "@/lib/session";
import type { TranslationResult } from "@/lib/types";

export default function ReviewPage() {
  const [results, setResults] = useState<TranslationResult[]>([]);

  useEffect(() => {
    const persisted = getSessionResults();
    if (persisted && persisted.length > 0) {
      setResults(persisted);
    }
  }, []);

  const completed = useMemo(
    () => results.filter((r) => r._status === "complete"),
    [results]
  );
  const flagged = useMemo(
    () => completed.filter((r) => r._bleu != null && r._bleu < 0.4),
    [completed]
  );

  const gradeCounts = CLINICAL_GRADES.map(
    (g) => flagged.filter((r) => r._clinical_grade === g.grade).length
  );

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

        {flagged.length === 0 ? (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-12 text-center">
            <div className="text-slate-500 text-lg mb-2">Run translations first</div>
            <p className="text-slate-600 text-sm">
              This page will display translation pairs with BLEU scores below
              0.4, ready for physician adjudication. Complete batch
              translations on the Translate tab to populate this view.
            </p>
          </div>
        ) : (
          <div className="bg-surface-800 rounded-[14px] border border-surface-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-700 text-[12px] text-slate-400">
              {flagged.length} flagged pair{flagged.length === 1 ? "" : "s"} (BLEU &lt; 0.4)
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="bg-surface-700 sticky top-0 z-10">
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">#</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">Spanish (input)</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">LLM English (output)</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold text-slate-400 text-[11px] tracking-wider border-b border-surface-600">BLEU</th>
                  </tr>
                </thead>
                <tbody>
                  {flagged.map((r, i) => (
                    <tr key={`${r.pair_id}-${i}`} className="border-b border-surface-700">
                      <td className="px-3.5 py-2.5 text-slate-500 font-mono text-[11px]">{i + 1}</td>
                      <td className="px-3.5 py-2.5 max-w-[380px] truncate text-slate-300">{r.spanish_source}</td>
                      <td className="px-3.5 py-2.5 max-w-[380px] truncate text-slate-200">{r.llm_english_translation}</td>
                      <td className="px-3.5 py-2.5 font-mono text-red-400">{r._bleu?.toFixed(3) ?? "--"}</td>
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
