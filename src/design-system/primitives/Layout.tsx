import { CSSProperties, ReactNode } from "react";
import "./primitives.css";

export function AppContainer({ children }: { children: ReactNode }) {
  return <div className="ds-app-container">{children}</div>;
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="ds-page-container">{children}</div>;
}

export function Section({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section className="ds-section" style={style}>{children}</section>;
}

export function Grid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  const cls = columns === 3 ? "three" : columns === 2 ? "two" : "";
  return <div className={`ds-grid ${cls}`.trim()}>{children}</div>;
}
