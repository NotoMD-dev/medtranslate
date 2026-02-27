"use client";

import { Mic } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

export default function TranscribePage() {
  return (
    <div className="page-container">
      {/* Top bar with theme toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        {/* Brand */}
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
            <span
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontWeight: 700,
                fontSize: 22,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              Med
            </span>
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--accent)",
                display: "inline-block",
                margin: "0 1.5px 3.5px 1.5px",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontWeight: 400,
                fontStyle: "italic",
                fontSize: 22,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              Scribe
            </span>
          </div>
          <span
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: "var(--text-muted)",
              marginTop: 3,
              display: "block",
            }}
          >
            Clinical Audio Transcription
          </span>
        </div>
        <ThemeToggle />
      </div>

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "var(--text-primary)",
            marginBottom: 6,
            lineHeight: 1.2,
          }}
        >
          Clinical Audio Transcription
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          Convert clinical audio recordings to text with automated accuracy
          evaluation.
        </p>
      </div>

      {/* Coming soon card */}
      <div
        className="anim d1"
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius)",
          padding: 64,
          boxShadow: "var(--shadow)",
          border: "1px solid var(--border)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
          }}
        >
          <Mic
            size={32}
            strokeWidth={1.5}
            style={{ color: "var(--accent-text)" }}
          />
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          Coming Soon
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "var(--text-muted)",
            maxWidth: 420,
            margin: "0 auto",
            lineHeight: 1.6,
          }}
        >
          med.scribe is currently under development. This tool will support
          clinical audio transcription with WER and CER evaluation metrics.
        </p>
      </div>
    </div>
  );
}
