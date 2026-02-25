"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./Toggle";

const tabs = [
  { href: "/", label: "Upload" },
  { href: "/translate", label: "Translate" },
  { href: "/review", label: "Review" },
  { href: "/metrics", label: "Metrics" },
];

export function TabNavigation() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem("medtranslate-theme") as "light" | "dark") || "light";
    setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("medtranslate-theme", theme);
  }, [theme]);

  return (
    <nav style={{ maxWidth: 1152, margin: "0 auto", padding: "24px 40px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 24 }}>{tabs.map((t) => <Link key={t.href} href={t.href} className={`ds-nav-link ${pathname === t.href ? "ds-nav-link-active" : ""}`}>{t.label}</Link>)}</div>
      <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "light" ? "dark" : "light")} />
    </nav>
  );
}
