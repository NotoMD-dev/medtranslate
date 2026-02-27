"use client";

import { useTheme } from "@/src/design-system";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
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
        boxShadow:
          theme === "light"
            ? "0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)"
            : "0 1px 4px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {theme === "light" ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      <span className="theme-toggle-label">
        {theme === "light" ? "Light Mode" : "Dark Mode"}
      </span>
    </button>
  );
}
