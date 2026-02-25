import type { CSSProperties, ReactNode } from "react";

function baseCard(style?: CSSProperties): CSSProperties {
  return {
    background: "var(--bg-surface)",
    borderRadius: "var(--radius)",
    padding: "var(--space-8)",
    boxShadow: "var(--shadow)",
    transition: "box-shadow 0.2s, background 0.3s, border-color 0.3s",
    ...style,
  };
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={baseCard(style)}>{children}</div>;
}

export function ElevatedCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={baseCard({ ...style })} onMouseEnter={(e)=>((e.currentTarget.style.boxShadow='var(--shadow-hover)'))} onMouseLeave={(e)=>((e.currentTarget.style.boxShadow='var(--shadow)'))}>{children}</div>;
}

export function SoftCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={baseCard({ boxShadow: "none", border: "1px solid var(--border)", ...style })}>{children}</div>;
}
