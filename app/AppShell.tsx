"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppContainer, PageContainer, ThemeToggle, TabNavigation } from "@/src/design-system";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = (pathname === "/translate" || pathname === "/review" || pathname === "/metrics" ? pathname : "/") as "/" | "/translate" | "/review" | "/metrics";

  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem("medtranslate-theme") as "light" | "dark" | null) || "light";
    setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("medtranslate-theme", theme);
  }, [theme]);

  return (
    <AppContainer>
      <PageContainer>
        <div className="ds-nav">
          <TabNavigation current={current} />
          <ThemeToggle theme={theme} onToggle={() => setTheme((p) => (p === "light" ? "dark" : "light"))} />
        </div>
        {children}
      </PageContainer>
    </AppContainer>
  );
}
