import { CLINICAL_GRADES, type ClinicalGrade } from "@/lib/types";

interface Props {
  value: ClinicalGrade | null;
  onChange: (grade: ClinicalGrade) => void;
  compact?: boolean;
}

export default function GradeSelector({ value, onChange, compact = false }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <span className="text-[11px] text-slate-400 font-semibold mr-1.5">
          Clinical Grade:
        </span>
      )}
      {CLINICAL_GRADES.map((g) => {
        const isActive = value === g.grade;
        return (
          <button
            key={g.grade}
            onClick={() => onChange(g.grade)}
            title={`Grade ${g.grade}: ${g.label} - ${g.description}`}
            className="rounded-lg text-[11px] font-bold transition-all cursor-pointer"
            style={{
              padding: compact ? "4px 10px" : "6px 14px",
              border: isActive
                ? `2px solid ${g.color}`
                : "1px solid #334155",
              background: isActive ? g.bg : "#1e293b",
              color: isActive ? g.color : "#94a3b8",
            }}
          >
            {g.grade}
          </button>
        );
      })}
    </div>
  );
}
