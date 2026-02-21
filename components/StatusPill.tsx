interface Props {
  status: "pending" | "translating" | "scoring" | "complete" | "error";
}

const STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "#f1f5f9", color: "#64748b", label: "Pending" },
  translating: { bg: "#dbeafe", color: "#2563eb", label: "Translating..." },
  scoring: { bg: "#fef3c7", color: "#d97706", label: "Scoring..." },
  complete: { bg: "#dcfce7", color: "#16a34a", label: "Complete" },
  error: { bg: "#fee2e2", color: "#dc2626", label: "Error" },
};

export default function StatusPill({ status }: Props) {
  const s = STYLES[status] || STYLES.pending;
  return (
    <span
      className="inline-block rounded-full text-[11px] font-semibold tracking-wide px-2.5 py-0.5"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}
