import { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

export function PrimaryButton({ children, className = "", ...props }: Props) {
  return <button className={`ds-btn primary ${className}`.trim()} {...props}>{children}</button>;
}

export function SecondaryButton({ children, className = "", ...props }: Props) {
  return <button className={`ds-btn secondary ${className}`.trim()} {...props}>{children}</button>;
}

export function GhostButton({ children, className = "", ...props }: Props) {
  return <button className={`ds-btn ghost ${className}`.trim()} {...props}>{children}</button>;
}
