import type { Metadata } from "next";
import "@/src/design-system/tokens.css";
import "@/src/design-system/theme.css";
import "./globals.css";
import AppShell from "./AppShell";

export const metadata: Metadata = {
  title: "MedTranslate",
  description:
    "Clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
