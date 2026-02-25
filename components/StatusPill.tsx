interface Props {
  status: "pending" | "translating" | "scoring" | "complete" | "error";
}

const STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  pending: { bg: "var(--bg-inset)", color: "var(--text-muted)", border: "var(--border)", label: "Pending" },
  translating: { bg: "var(--accent-soft)", color: "var(--accent-text)", border: "transparent", label: "Translating..." },
  scoring: { bg: "var(--warning-light)", color: "var(--warning)", border: "var(--warning-border)", label: "Scoring..." },
  complete: { bg: "var(--success-light)", color: "var(--success)", border: "var(--success-border)", label: "Complete" },
  error: { bg: "var(--danger-light)", color: "var(--danger)", border: "var(--danger-border)", label: "Error" },
};

export default function StatusPill({ status }: Props) {
  const s = STYLES[status] || STYLES.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        padding: "3px 10px",
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {s.label}
    </span>
  );
}
