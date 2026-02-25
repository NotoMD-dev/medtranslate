import { ReactNode } from "react";

export const StatusBadge = ({ children }: { children: ReactNode }) => <span className="ds-badge status">{children}</span>;
export const WarningBadge = ({ children }: { children: ReactNode }) => <span className="ds-badge warning">{children}</span>;
export const DangerBadge = ({ children }: { children: ReactNode }) => <span className="ds-badge danger">{children}</span>;
export const AccentBadge = ({ children }: { children: ReactNode }) => <span className="ds-badge accent">{children}</span>;

export function DatasetBadge({ dataset }: { dataset: string }) {
  const cls = dataset.includes("UMass") ? "umass" : "clinspen";
  const label = dataset.includes("UMass") ? "UMass" : "ClinSpEn";
  return <span className={`ds-badge dataset ${cls}`}>{label}</span>;
}

export function GradeBadge({ selected, children, ...props }: { selected?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`ds-grade-badge ${selected ? "selected" : ""}`.trim()} {...props}>{children}</button>;
}
