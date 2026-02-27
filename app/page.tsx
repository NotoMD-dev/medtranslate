"use client";

import Link from "next/link";
import { Languages, Mic, ArrowRight } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const TOOLS = [
  {
    href: "/translate",
    icon: Languages,
    title: "Translate Clinical Text",
    subtitle: "med.translate",
    description:
      "Batch translate clinical text with LLMs and evaluate quality using publication-grade metrics.",
    metrics: "BLEU / METEOR / BERTScore",
  },
  {
    href: "/transcribe",
    icon: Mic,
    title: "Transcribe Clinical Audio",
    subtitle: "med.scribe",
    description:
      "Convert clinical audio recordings to text with automated accuracy evaluation.",
    metrics: "WER / CER",
  },
];

export default function DashboardPage() {
  return (
    <div className="page-container">
      {/* Top bar with theme toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <ThemeToggle />
      </div>

      {/* Hero header */}
      <div className="anim" style={{ marginBottom: 48 }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "var(--text-primary)",
            marginBottom: 8,
            lineHeight: 1.2,
          }}
        >
          Clinical Research Tools
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--text-muted)",
            margin: 0,
            maxWidth: 540,
            lineHeight: 1.6,
          }}
        >
          NLP-powered tools for medical text processing and evaluation.
        </p>
      </div>

      {/* Feature cards */}
      <div className="dashboard-grid">
        {TOOLS.map((tool, i) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className={`anim d${i + 1}`}
              style={{ textDecoration: "none", display: "block" }}
            >
              <div
                className="dashboard-card"
                style={{
                  background: "var(--bg-surface)",
                  borderRadius: "var(--radius)",
                  padding: 32,
                  boxShadow: "var(--shadow)",
                  border: "1px solid var(--border)",
                  transition:
                    "box-shadow 0.25s ease, border-color 0.25s ease, transform 0.25s ease",
                  cursor: "pointer",
                  height: "100%",
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "var(--radius-xs)",
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 20,
                  }}
                >
                  <Icon
                    size={24}
                    strokeWidth={1.5}
                    style={{ color: "var(--accent-text)" }}
                  />
                </div>

                {/* Tool name badge */}
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--accent-text)",
                    marginBottom: 8,
                  }}
                >
                  {tool.subtitle}
                </div>

                {/* Title */}
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    margin: "0 0 8px 0",
                    lineHeight: 1.3,
                  }}
                >
                  {tool.title}
                </h2>

                {/* Description */}
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--text-secondary)",
                    margin: "0 0 20px 0",
                    lineHeight: 1.6,
                  }}
                >
                  {tool.description}
                </p>

                {/* Metrics badge + arrow */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "4px 12px",
                      borderRadius: 100,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "var(--bg-inset)",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {tool.metrics}
                  </span>
                  <ArrowRight
                    size={18}
                    strokeWidth={1.5}
                    style={{ color: "var(--text-muted)" }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
