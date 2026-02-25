import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        surface: {
          900: "#0a0f1a",
          800: "#111827",
          700: "#1e293b",
          600: "#334155",
        },
        accent: {
          blue: "#0ea5e9",
          indigo: "#6366f1",
        },
        clinical: {
          safe: "#10b981",
          minor: "#f59e0b",
          moderate: "#f97316",
          critical: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};

export default config;