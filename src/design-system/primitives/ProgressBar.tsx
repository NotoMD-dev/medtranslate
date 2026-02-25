export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        <span>{value} / {total} graded</span><span>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 9999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: 4, borderRadius: 9999, background: "var(--accent)" }} />
      </div>
    </div>
  );
}
