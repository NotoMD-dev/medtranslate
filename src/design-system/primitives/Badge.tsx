import type { ReactNode, HTMLAttributes } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "accent" | "dataset" | "dataset-alt";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  success: {
    background: "var(--success-light)",
    color: "var(--success)",
    borderColor: "var(--success-border)",
  },
  warning: {
    background: "var(--warning-light)",
    color: "var(--warning)",
    borderColor: "var(--warning-border)",
  },
  danger: {
    background: "var(--danger-light)",
    color: "var(--danger)",
    borderColor: "var(--danger-border)",
  },
  accent: {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    borderColor: "transparent",
  },
  dataset: {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    borderColor: "transparent",
  },
  "dataset-alt": {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    borderColor: "transparent",
  },
};

export function Badge({ variant, children, style, ...rest }: BadgeProps) {
  const vs = variantStyles[variant];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: variant.startsWith("dataset") ? "2px 8px" : "3px 10px",
        borderRadius: 100,
        fontSize: variant.startsWith("dataset") ? 10 : 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        border: "1px solid",
        ...vs,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
