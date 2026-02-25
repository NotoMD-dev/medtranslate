"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { parseCSV } from "@/lib/csv";
import { parseFile } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import {
  clearSessionState,
  setSessionData,
  setSessionPrompt,
  setSessionRowLimit,
  setSessionJobResultsAsync,
  setSessionJobId,
  setSessionCsvFileName,
} from "@/lib/session";
import type { TranslationPair } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rowMode, setRowMode] = useState<"all" | "custom">("all");
  const [customRowCount, setCustomRowCount] = useState<string>("");

  const processFile = useCallback(
    (file: File) => {
      setError(null);
      const name = file.name.toLowerCase();
      const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");

      if (!isXlsx && !name.endsWith(".csv")) {
        setError("Unsupported file type. Please upload a .csv or .xlsx file.");
        return;
      }

      setFileName(file.name);

      if (isXlsx) {
        // Send XLSX to backend for safe parsing with openpyxl
        parseFile(file)
          .then((parsed) => {
            setRows(parsed);
            setSessionData(parsed);
            setSessionPrompt(systemPrompt);
            setSessionCsvFileName(file.name);
          })
          .catch((err) => {
            setError((err as Error).message);
          });
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = parseCSV(ev.target?.result as string);
            setRows(parsed);
            setSessionData(parsed);
            setSessionPrompt(systemPrompt);
            setSessionCsvFileName(file.name);
          } catch (err) {
            setError((err as Error).message);
          }
        };
        reader.readAsText(file);
      }
    },
    [systemPrompt]
  );

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDelete = useCallback(() => {
    setRows([]);
    setFileName(null);
    setError(null);
    setRowMode("all");
    setCustomRowCount("");
    clearSessionState();
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }, []);

  const handleContinue = useCallback(() => {
    let limit: number | undefined;
    if (rowMode === "custom") {
      const parsed = parseInt(customRowCount, 10);
      if (!parsed || parsed < 1) {
        setError("Please enter a valid number of rows (1 or more).");
        return;
      }
      limit = parsed;
    }

    // Apply row limit to global data
    const dataToUse = limit ? rows.slice(0, limit) : rows;
    setSessionData(dataToUse);
    setSessionPrompt(systemPrompt);
    setSessionRowLimit(limit);
    setSessionJobResultsAsync(undefined);
    setSessionJobId(undefined);
    router.push("/translate");
  }, [rowMode, customRowCount, rows, systemPrompt, router]);

  const sources = [...new Set(rows.map((r) => r.source))].filter(Boolean);
  const hasRef = rows.some((r) => r.english_reference);

  const effectiveRowCount =
    rowMode === "custom" && customRowCount
      ? Math.min(parseInt(customRowCount, 10) || rows.length, rows.length)
      : rows.length;

  return (
    <div className="page-container">
      <Header />

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
          Upload Dataset
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          Import a CSV/XLSX with clinical translation pairs. Required column:{" "}
          <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
            spanish_source
          </strong>
          .
        </p>
      </div>

      {/* Drop zone / File info card */}
      <div
        className="anim d1"
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius)",
          padding: 32,
          boxShadow: "var(--shadow)",
        }}
      >
        {rows.length === 0 ? (
          <div
            className="drop-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)",
              textAlign: "center",
              cursor: "pointer",
              transition: "all 0.2s",
              background: isDragging ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12, color: "var(--text-muted)" }}>
              &#8593;
            </div>
            <div style={{ fontSize: 15, color: "var(--text-secondary)" }}>
              Drag and drop CSV/Excel (.xlsx) files here or click to browse
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
              Supports .csv and .xlsx up to 50MB
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-xs)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  background: "var(--accent-soft)",
                  color: "var(--accent-text)",
                  fontWeight: 700,
                }}
              >
                {fileName?.endsWith(".xlsx") || fileName?.endsWith(".xls")
                  ? "XL"
                  : "CSV"}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                  {fileName}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {rows.length.toLocaleString()} rows loaded
                </div>
              </div>
            </div>
            <button
              onClick={handleDelete}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-xs)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--danger)",
                border: "1px solid var(--danger-border)",
                background: "var(--danger-light)",
                cursor: "pointer",
                fontFamily: "var(--font)",
              }}
            >
              Remove file
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleUpload}
        className="hidden"
      />

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: "var(--danger-light)",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--danger)",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Dataset stats */}
      {rows.length > 0 && (
        <div
          className="anim d2 stats-row"
          style={{
            marginTop: 24,
            background: "var(--bg-surface)",
            borderRadius: "var(--radius)",
            padding: 32,
            boxShadow: "var(--shadow)",
          }}
        >
          <div>
            <span style={{ color: "var(--accent-text)", fontWeight: 700, fontSize: 24 }}>
              {effectiveRowCount.toLocaleString()}
            </span>{" "}
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {rowMode === "custom" && customRowCount
                ? `of ${rows.length.toLocaleString()} pairs selected`
                : "pairs loaded"}
            </span>
          </div>
          <div className="stats-divider" />
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
            Sources: {sources.join(", ") || "N/A"}
          </div>
          <div className="stats-divider" />
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
            Reference translations: {hasRef ? "Yes" : "No"}
          </div>
        </div>
      )}

      {/* Row limit option */}
      {rows.length > 0 && (
        <div className="anim d3" style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            Rows to Analyze
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => setRowMode("all")}
              style={{
                flex: 1,
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "all 0.2s",
                background: rowMode === "all" ? "var(--accent-soft)" : "transparent",
                border: `1.5px solid ${rowMode === "all" ? "var(--accent)" : "var(--border)"}`,
                color: rowMode === "all" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              Entire file ({rows.length.toLocaleString()} rows)
            </button>
            <button
              onClick={() => setRowMode("custom")}
              style={{
                flex: 1,
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "all 0.2s",
                background: rowMode === "custom" ? "var(--accent-soft)" : "transparent",
                border: `1.5px solid ${rowMode === "custom" ? "var(--accent)" : "var(--border)"}`,
                color: rowMode === "custom" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              Custom number of rows
            </button>
          </div>
          {rowMode === "custom" && (
            <div style={{ marginTop: 12 }}>
              <input
                type="number"
                min="1"
                max={rows.length}
                value={customRowCount}
                onChange={(e) => setCustomRowCount(e.target.value)}
                placeholder={`Enter number (1 - ${rows.length.toLocaleString()})`}
                style={{
                  width: "100%",
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-xs)",
                  padding: "14px 16px",
                  color: "var(--text-primary)",
                  fontSize: 15,
                  fontFamily: "var(--font)",
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* System prompt */}
      <div
        className="anim d4"
        style={{
          marginTop: 32,
          background: "var(--bg-surface)",
          borderRadius: "var(--radius)",
          padding: 32,
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
                lineHeight: 1.3,
              }}
            >
              System Prompt
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: "4px 0 0 0",
              }}
            >
              The instruction sent to the LLM for each translation.
            </p>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 14px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 600,
              background: "var(--bg-inset)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              userSelect: "none",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Read-only
          </span>
        </div>
        <div
          style={{
            width: "100%",
            minHeight: 120,
            background: "var(--bg-inset)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: 20,
            color: "var(--text-secondary)",
            fontSize: 15,
            fontFamily: "var(--font)",
            lineHeight: 1.75,
            whiteSpace: "pre-wrap",
            overflowY: "auto",
            maxHeight: 200,
          }}
        >
          {systemPrompt}
        </div>
      </div>

      {/* Continue button */}
      {rows.length > 0 && (
        <div className="anim d5" style={{ marginTop: 32, textAlign: "center", paddingBottom: 64 }}>
          <button
            onClick={handleContinue}
            style={{
              padding: "14px 44px",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font)",
              transition: "all 0.2s",
            }}
          >
            Continue to Translation
          </button>
        </div>
      )}
    </div>
  );
}
