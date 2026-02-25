interface Props {
  label: string;
  value: number | null;
  description?: string;
  count?: number;
}

export default function MetricsCard({ label, value, description, count }: Props) {
  return (
    <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: description || count != null ? 16 : 0 }}>
        {value != null ? value.toFixed(3) : "--"}
      </div>
      {description && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{description}</div>
      )}
      {count != null && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>n = {count}</div>
      )}
    </div>
  );
}
