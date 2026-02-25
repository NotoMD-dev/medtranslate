import type { ReactNode } from "react";

interface MetricValueProps {
  label: string;
  children: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
}

export function MetricValue({ label, children, detail, badge }: MetricValueProps) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 52,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: "var(--accent-text)",
          lineHeight: 1,
          marginBottom: detail || badge ? 16 : 0,
        }}
      >
        {children}
      </div>
      {detail && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginBottom: badge ? 12 : 0,
          }}
        >
          {detail}
        </div>
      )}
      {badge}
    </div>
  );
}
