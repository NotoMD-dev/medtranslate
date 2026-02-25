interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  labelRight?: string;
}

export function ProgressBar({ value, label, labelRight }: ProgressBarProps) {
  return (
    <div>
      {(label || labelRight) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--text-muted)",
            marginBottom: 6,
          }}
        >
          <span>{label}</span>
          <span>{labelRight}</span>
        </div>
      )}
      <div
        style={{
          height: 4,
          background: "var(--border)",
          borderRadius: 100,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "var(--accent)",
            borderRadius: 100,
            transition: "width 0.6s ease",
            width: `${Math.min(100, Math.max(0, value))}%`,
          }}
        />
      </div>
    </div>
  );
}
