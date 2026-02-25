import { ReactNode } from "react";

function CardBase({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ds-card ${className}`.trim()}>{children}</div>;
}

export function Card({ children }: { children: ReactNode }) {
  return <CardBase>{children}</CardBase>;
}

export function ElevatedCard({ children }: { children: ReactNode }) {
  return <CardBase className="elevated">{children}</CardBase>;
}

export function SoftCard({ children }: { children: ReactNode }) {
  return <CardBase className="soft">{children}</CardBase>;
}
