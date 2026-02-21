interface Props {
  label: string;
  value: number | null;
  description?: string;
  count?: number;
}

export default function MetricsCard({ label, value, description, count }: Props) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-[14px] p-6">
      <div className="text-[11px] text-slate-500 font-semibold tracking-widest mb-2">
        {label}
      </div>
      <div className="text-4xl font-light font-mono text-slate-100 tracking-tight">
        {value != null ? value.toFixed(3) : "--"}
      </div>
      {description && (
        <div className="text-[11px] text-slate-500 mt-1.5">{description}</div>
      )}
      {count != null && (
        <div className="text-[11px] text-slate-600 mt-0.5">n = {count}</div>
      )}
    </div>
  );
}
