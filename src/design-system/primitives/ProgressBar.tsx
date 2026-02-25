export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="ds-progress-track" aria-label="progress">
      <div className="ds-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
