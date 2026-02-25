import type { ReactNode } from "react";

export function DataTable({ children }: { children: ReactNode }) { return <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>; }
export function TableHeader({ children }: { children: ReactNode }) { return <th style={{ padding: "16px 10px", textAlign: "left", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>{children}</th>; }
export function TableRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) { return <tr className="ds-table-row" onClick={onClick} style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 70%, transparent)", cursor: onClick ? "pointer" : "default" }}>{children}</tr>; }
