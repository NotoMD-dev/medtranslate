import type { ReactNode, HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  padding?: "none" | "default";
}

export function Card({ children, hover = true, padding = "default", className = "", style, ...rest }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius)",
        padding: padding === "none" ? 0 : 32,
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
        transition: "background 0.35s, box-shadow 0.25s, border-color 0.3s",
        ...(hover ? {} : {}),
        ...style,
      }}
      onMouseEnter={hover ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-hover)"; } : undefined}
      onMouseLeave={hover ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow)"; } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
