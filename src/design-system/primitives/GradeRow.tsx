interface GradeRowProps {
  label: string;
  dotColor: string;
  barColor: string;
  count: number;
  maxCount: number;
}

export function GradeRow({ label, dotColor, barColor, count, maxCount }: GradeRowProps) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr 48px",
        alignItems: "center",
        gap: 16,
        padding: "16px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            background: dotColor,
          }}
        />
        {label}
      </div>
      <div
        style={{
          height: 8,
          background: "var(--bg-inset)",
          borderRadius: 100,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 100,
            transition: "width 0.5s ease",
            width: `${pct}%`,
            background: barColor,
          }}
        />
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {count}
      </div>
    </div>
  );
}
