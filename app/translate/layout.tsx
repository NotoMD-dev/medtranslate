"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const TRANSLATE_NAV = [
  { href: "/translate", label: "Upload" },
  { href: "/translate/run", label: "Translate" },
  { href: "/translate/review", label: "Review" },
  { href: "/translate/compare", label: "Compare" },
  { href: "/translate/metrics", label: "Metrics" },
];

export default function TranslateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div>
      {/* Translate section header */}
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "24px 40px 0",
          background: "var(--bg-base)",
        }}
      >
        {/* Brand + theme toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <Link
            href="/translate"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              flexDirection: "column",
            }}
          >
            {/* med.translate wordmark */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                Med
              </span>
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  display: "inline-block",
                  margin: "0 1.5px 3.5px 1.5px",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontWeight: 400,
                  fontStyle: "italic",
                  fontSize: 22,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                Translate
              </span>
            </div>
            <span
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                color: "var(--text-muted)",
                marginTop: 3,
              }}
            >
              Clinical Translation Platform
            </span>
          </Link>

          <ThemeToggle />
        </div>

        {/* Sub-navigation tabs */}
        <nav
          className="site-nav"
          style={{
            display: "flex",
            gap: 32,
            paddingBottom: 0,
            marginBottom: 0,
          }}
        >
          {TRANSLATE_NAV.map(({ href, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                style={{
                  background: "none",
                  border: "none",
                  fontFamily: "var(--font)",
                  fontSize: 15,
                  fontWeight: 500,
                  color: isActive
                    ? "var(--accent-text)"
                    : "var(--text-muted)",
                  cursor: "pointer",
                  padding: "8px 0",
                  borderBottom: isActive
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  textDecoration: "none",
                  transition: "color 0.2s, border-color 0.2s",
                  marginBottom: -1,
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
