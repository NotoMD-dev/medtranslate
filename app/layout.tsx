import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { ThemeProvider } from "@/src/design-system";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedTranslate",
  description:
    "Clinical translation research platform for evaluating LLM-generated Spanish-to-English medical translations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}