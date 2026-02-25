import type { ReactNode } from "react";

function B({ children, bg, color, border }: { children: ReactNode; bg: string; color: string; border?: string }) {
  return <span style={{ borderRadius: 9999, padding: "2px 10px", fontSize: 11, fontWeight: 600, background: bg, color, border: border ? `1px solid ${border}` : "1px solid transparent" }}>{children}</span>;
}

export function StatusBadge({ children }: { children: ReactNode }) { return <B bg="var(--success-light)" color="var(--success)" border="var(--success-border)">{children}</B>; }
export function WarningBadge({ children }: { children: ReactNode }) { return <B bg="var(--warning-light)" color="var(--warning)" border="var(--warning-border)">{children}</B>; }
export function DangerBadge({ children }: { children: ReactNode }) { return <B bg="var(--danger-light)" color="var(--danger)" border="var(--danger-border)">{children}</B>; }
export function AccentBadge({ children }: { children: ReactNode }) { return <B bg="var(--accent-soft)" color="var(--accent-text)">{children}</B>; }
export function DatasetBadge({ source }: { source: string }) { return source.includes("UMass") ? <B bg="#F3E8FF" color="#7C3AED">UMass</B> : <B bg="var(--accent-soft)" color="var(--accent-text)">ClinSpEn</B>; }
export function GradeBadge({ label, selected, onClick }: { label: string; selected?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} style={{ minWidth: 64, padding: "8px 16px", borderRadius: "var(--radius-sm)", border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent-soft)" : "transparent", color: selected ? "var(--accent-text)" : "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>;
}
