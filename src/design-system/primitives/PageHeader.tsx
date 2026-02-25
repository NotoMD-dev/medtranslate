import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "var(--text-primary)",
          marginBottom: 6,
          lineHeight: 1.2,
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
