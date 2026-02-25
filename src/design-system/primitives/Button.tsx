import type { ButtonHTMLAttributes, CSSProperties } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;
const base: CSSProperties = { padding: "8px 24px", borderRadius: "var(--radius-sm)", fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" };

export function PrimaryButton(props: Props) { return <button {...props} style={{ ...base, background: "var(--accent)", color: "white", border: "1px solid var(--accent)", ...(props.style || {}) }} />; }
export function SecondaryButton(props: Props) { return <button {...props} style={{ ...base, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", ...(props.style || {}) }} />; }
export function GhostButton(props: Props) { return <button {...props} style={{ ...base, padding: "8px 12px", background: "transparent", color: "var(--text-muted)", border: "none", ...(props.style || {}) }} />; }
