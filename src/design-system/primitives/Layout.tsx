import type { CSSProperties, ReactNode } from "react";

export function AppContainer({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        transition: "background 0.3s, color 0.3s, border-color 0.3s, box-shadow 0.3s",
      }}
    >
      {children}
    </div>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <main style={{ maxWidth: 1152, margin: "0 auto", padding: "64px 40px 48px" }}>{children}</main>;
}

export function Section({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section className="ds-fade-up" style={{ marginBottom: "var(--space-12)", ...style }}>{children}</section>;
}

export function Grid({ children, columns = "1fr", gap = "var(--space-8)" }: { children: ReactNode; columns?: string; gap?: string }) {
  return <div style={{ display: "grid", gridTemplateColumns: columns, gap }}>{children}</div>;
}
