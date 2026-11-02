import type { SentenceMetrics, ClinicalGrade } from "@/lib/types";
import GradeSelector from "./GradeSelector";

interface Props {
  sentence: SentenceMetrics;
  grade: ClinicalGrade | null;
  onGrade: (grade: ClinicalGrade) => void;
  onClose: () => void;
}

export default function PairDetail({ sentence, grade, onGrade, onClose }: Props) {
  return (
    <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          Pair Detail:{" "}
          <span style={{ color: "var(--accent-text)" }}>{sentence.pair_id}</span>
        </div>
        <button
          onClick={onClose}
          style={{ color: "var(--text-muted)", fontSize: 20, background: "transparent", border: "none", cursor: "pointer" }}
        >
          &times;
        </button>
      </div>

      {/* Three-column text comparison */}
      <div className="pair-grid">
        <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Source Text</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 176, overflow: "auto" }}>{sentence.source_text || sentence.spanish_source}</div>
        </div>
        <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>English Reference (Gold Standard)</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 176, overflow: "auto" }}>{sentence.english_reference}</div>
        </div>
        <div style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-sm)", padding: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>LLM Translation</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)", maxHeight: 176, overflow: "auto" }}>{sentence.llm_english_translation || "Pending..."}</div>
        </div>
      </div>

      {/* Metrics row + grading */}
      <div className="pair-footer">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(
            [
              ["METEOR", sentence.meteor],
              ["BERTScore F1", sentence.bertscore_f1],
            ] as [string, number | null][]
          ).map(([label, val]) => (
            <div key={label} style={{ background: "var(--bg-inset)", borderRadius: "var(--radius-xs)", padding: "8px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-text)" }}>{val != null ? val.toFixed(3) : "--"}</div>
            </div>
          ))}
        </div>
        <div className="pair-grade">
          <GradeSelector value={grade} onChange={onGrade} />
        </div>
      </div>

      {sentence.format_warning && (
        <div style={{ marginTop: 12, padding: 12, background: "var(--warning-light)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-xs)", color: "var(--warning)", fontSize: 12 }}>
          <strong>Format warning:</strong> the reply {sentence.format_warning}. The text is scored exactly as returned, so this can lower BLEU without a translation error.
        </div>
      )}

      {sentence.error && (
        <div style={{ marginTop: 12, padding: 12, background: sentence.error_kind === "refusal" ? "var(--danger-light)" : "var(--warning-light)", border: `1px solid ${sentence.error_kind === "refusal" ? "var(--danger-border)" : "var(--warning-border)"}`, borderRadius: "var(--radius-xs)", color: sentence.error_kind === "refusal" ? "var(--danger)" : "var(--warning)", fontSize: 12 }}>
          <strong>{sentence.error_kind === "refusal" ? "Refused (scored as 0):" : "Incomplete (not scored):"}</strong> {sentence.error}
        </div>
      )}
    </div>
  );
}
