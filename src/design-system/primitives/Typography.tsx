import type { ReactNode } from "react";

export function Heading({ children }: { children: ReactNode }) {
  return <h1 style={{ fontSize: 32, lineHeight: 1.1, fontWeight: 600, letterSpacing: -0.5, margin: 0 }}>{children}</h1>;
}

export function Subheading({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: 24, lineHeight: 1.2, fontWeight: 600, margin: 0 }}>{children}</h2>;
}

export function MetaText({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{children}</div>;
}

export function MetricValue({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.8, color: "var(--accent-text)" }}>{children}</div>;
}
