"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/src/design-system";

const NAV_ITEMS = [
  { href: "/", label: "Upload" },
  { href: "/translate", label: "Translate" },
  { href: "/review", label: "Review" },
  { href: "/metrics", label: "Metrics" },
];

export default function Header() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 48,
      }}
    >
      <div style={{ display: "flex", gap: 32 }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              style={{
                background: "none",
                border: "none",
                fontFamily: "var(--font)",
                fontSize: 14,
                fontWeight: 500,
                color: isActive ? "var(--accent-text)" : "var(--text-muted)",
                cursor: "pointer",
                padding: "4px 0",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                textDecoration: "none",
                transition: "color 0.2s, border-color 0.2s",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>
      <button
        onClick={toggleTheme}
        style={{
          fontFamily: "var(--font)",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-secondary)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 100,
          padding: "8px 20px",
          cursor: "pointer",
          transition: "all 0.2s",
          boxShadow: "var(--shadow)",
        }}
      >
        {theme === "light" ? "Dark Mode" : "Light Mode"}
      </button>
    </nav>
  );
}
