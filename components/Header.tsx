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
    <header style={{ marginBottom: 48 }}>
      {/* Brand bar */}
      <div
        className="brand-bar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Pulse icon */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
                lineHeight: 1.1,
                fontFamily: "var(--font)",
              }}
            >
              Med<span style={{ color: "var(--accent)" }}>Translate</span>
            </div>
            <div
              className="brand-tagline"
              style={{
                fontSize: 11.5,
                color: "var(--text-muted)",
                letterSpacing: "0.01em",
                lineHeight: 1.3,
                marginTop: 1,
              }}
            >
              Clinical Translation Research
            </div>
          </div>
        </Link>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          style={{
            fontFamily: "var(--font)",
            fontSize: 13,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: theme === "light" ? "#1A1D1A" : "#F5F7F5",
            background: theme === "light" ? "#F4F5F7" : "#262C28",
            border: theme === "light" ? "1px solid #CDD1C9" : "1px solid #3A423C",
            borderRadius: 100,
            padding: "8px 20px",
            cursor: "pointer",
            transition: "all 0.3s ease",
            boxShadow: theme === "light"
              ? "0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)"
              : "0 1px 4px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {theme === "light" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
          <span className="theme-toggle-label">{theme === "light" ? "Light Mode" : "Dark Mode"}</span>
        </button>
      </div>

      {/* Navigation links */}
      <nav
        className="site-nav"
        style={{
          display: "flex",
          gap: 32,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 0,
          marginBottom: 0,
        }}
      >
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
                fontSize: 15,
                fontWeight: 500,
                color: isActive ? "var(--accent-text)" : "var(--text-muted)",
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
    </header>
  );
}
