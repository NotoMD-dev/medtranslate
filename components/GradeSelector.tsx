import { CLINICAL_GRADES, type ClinicalGrade } from "@/lib/types";

interface Props {
  value: ClinicalGrade | null;
  onChange: (grade: ClinicalGrade) => void;
  compact?: boolean;
}

export default function GradeSelector({ value, onChange, compact = false }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {!compact && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginRight: 6 }}>
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
            style={{
              fontFamily: "var(--font)",
              fontSize: 12,
              fontWeight: 500,
              padding: compact ? "4px 10px" : "10px 20px",
              borderRadius: "var(--radius-xs)",
              border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: isActive ? "var(--accent-soft)" : "transparent",
              color: isActive ? "var(--accent-text)" : "var(--text-secondary)",
              cursor: "pointer",
              transition: "all 0.2s",
              textAlign: "center",
              minWidth: compact ? undefined : 72,
            }}
          >
            <span style={{ display: "block", fontSize: compact ? 11 : 20, fontWeight: 700, marginBottom: compact ? 0 : 2 }}>{g.grade}</span>
            {!compact && <span style={{ display: "block", fontSize: 10, opacity: 0.7 }}>{g.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
