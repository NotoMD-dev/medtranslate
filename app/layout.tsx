import type { Metadata } from "next";
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
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface-900 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
