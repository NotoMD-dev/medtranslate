import type { TranslationResult, ClinicalGrade } from "@/lib/types";
import GradeSelector from "./GradeSelector";

interface Props {
  result: TranslationResult;
  onGrade: (grade: ClinicalGrade) => void;
  onClose: () => void;
}

export default function PairDetail({ result, onGrade, onClose }: Props) {
  return (
    <div className="bg-surface-800 rounded-[14px] border border-surface-700 p-6">
      <div className="flex justify-between items-start mb-5">
        <div className="text-sm font-semibold text-slate-100">
          Pair Detail:{" "}
          <span className="font-mono text-accent-blue">{result.pair_id}</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-xl bg-transparent border-none cursor-pointer"
        >
          &times;
        </button>
      </div>

      {/* Three-column text comparison */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
            SPANISH SOURCE
          </div>
          <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-44 overflow-auto text-slate-300">
            {result.spanish_source}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
            ENGLISH REFERENCE (Gold Standard)
          </div>
          <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-44 overflow-auto text-cyan-200">
            {result.english_reference}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold text-slate-500 tracking-widest mb-1.5">
            LLM TRANSLATION
          </div>
          <div className="bg-surface-700 rounded-lg p-3.5 text-[13px] leading-relaxed max-h-44 overflow-auto text-violet-300">
            {result.llm_english_translation || "Pending..."}
          </div>
        </div>
      </div>

      {/* Metrics row + grading */}
      <div className="flex items-center gap-4">
        <div className="flex gap-3">
          {(
            [
              ["BLEU", result._bleu],
              ["METEOR", result._meteor],
              ["BERTProxy", result._bert_proxy],
            ] as [string, number | null][]
          ).map(([label, val]) => (
            <div
              key={label}
              className="bg-surface-700 rounded-lg px-4 py-2 text-center"
            >
              <div className="text-[10px] text-slate-500 font-semibold">
                {label}
              </div>
              <div className="text-base font-bold font-mono text-slate-100">
                {val != null ? val.toFixed(3) : "--"}
              </div>
            </div>
          ))}
        </div>
        <div className="ml-auto">
          <GradeSelector value={result._clinical_grade} onChange={onGrade} />
        </div>
      </div>
    </div>
  );
}
