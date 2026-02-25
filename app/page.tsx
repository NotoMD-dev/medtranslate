"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCSV } from "@/lib/csv";
import { parseFile } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT, TranslationPair } from "@/lib/types";
import {
  clearSessionState,
  setSessionCsvFileName,
  setSessionData,
  setSessionJobId,
  setSessionJobResultsAsync,
  setSessionPrompt,
  setSessionRowLimit,
} from "@/lib/session";
import { clearUploadedFile, setUploadedFile } from "@/lib/upload-cache";
import {
  AccentBadge,
  BodyText,
  Card,
  Heading,
  MetaText,
  PrimaryButton,
  SecondaryButton,
  Section,
  StatusBadge,
} from "@/src/design-system";

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [rowMode, setRowMode] = useState<"all" | "custom">("all");
  const [customRowCount, setCustomRowCount] = useState<string>("");
  const [systemPrompt, setSystemPromptValue] = useState<string>(DEFAULT_SYSTEM_PROMPT);

  const rowCount = rows.length;
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source))], [rows]);
  const hasReference = useMemo(() => rows.some((r) => Boolean(r.english_reference?.trim())), [rows]);

  const processFile = useCallback(async (file: File) => {
    setError("");
    setNotice("");
    setFileName(file.name);
    setUploadedFile(file);
    setRowMode("all");
    setCustomRowCount("");

    const lowerName = file.name.toLowerCase();
    const isSpreadsheet = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    const isCsv = lowerName.endsWith(".csv");

    if (!isSpreadsheet && !isCsv) {
      setError("Unsupported file type. Please upload a .csv or .xlsx file.");
      return;
    }

    try {
      const parsed = isSpreadsheet ? await parseFile(file) : parseCSV(await file.text());
      setRows(parsed);
      setSessionData(parsed);
      setSessionPrompt(systemPrompt);
      setSessionCsvFileName(file.name);
      setSessionRowLimit(undefined);
      setSessionJobId(undefined);
      await setSessionJobResultsAsync(undefined);
      if (isSpreadsheet) {
        setNotice("XLSX file parsed successfully.");
      }
    } catch (err) {
      if (isSpreadsheet) {
        setRows([]);
        setSessionData(undefined);
        setSessionPrompt(systemPrompt);
        setSessionCsvFileName(file.name);
        setNotice("XLSX file accepted. Preview is unavailable until backend parse is reachable, but you can continue to Translate.");
      } else {
        setError((err as Error).message);
      }
    }
  }, [systemPrompt]);

  const clearAll = useCallback(() => {
    setRows([]);
    setFileName("");
    setError("");
    setNotice("");
    setRowMode("all");
    setCustomRowCount("");
    setSystemPromptValue(DEFAULT_SYSTEM_PROMPT);
    clearSessionState();
    clearUploadedFile();
  }, []);

  const handleContinue = useCallback(async () => {
    if (!fileName) return;

    let limit: number | undefined;
    if (rowMode === "custom") {
      const parsed = parseInt(customRowCount, 10);
      if (!parsed || parsed < 1) {
        setError("Please enter a valid number of rows (1 or more).");
        return;
      }
      if (rowCount > 0 && parsed > rowCount) {
        setError(`Custom rows cannot exceed loaded rows (${rowCount}).`);
        return;
      }
      limit = parsed;
    }

    if (rowCount > 0) {
      const selectedRows = limit ? rows.slice(0, limit) : rows;
      setSessionData(selectedRows);
    }

    setSessionPrompt(systemPrompt);
    setSessionRowLimit(limit);
    setSessionJobId(undefined);
    await setSessionJobResultsAsync(undefined);

    router.push("/translate");
  }, [customRowCount, fileName, rowCount, rowMode, rows, router, systemPrompt]);

  const canContinue = Boolean(fileName);

  return (
    <>
      <Section>
        <Heading>Upload Dataset</Heading>
        <BodyText>CSV or XLSX with <strong>spanish_source</strong> and optional <strong>english_reference</strong> columns.</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <MetaText>Data Import</MetaText>
            <AccentBadge>CSV + XLSX supported</AccentBadge>
          </div>

          <div
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) processFile(file);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed var(${isDragging ? "--accent" : "--border"})`,
              background: isDragging ? "var(--accent-soft)" : "color-mix(in srgb, var(--bg-base) 35%, transparent)",
              borderRadius: "var(--radius)",
              padding: "86px 24px",
              textAlign: "center",
              cursor: "pointer",
              transition: "background 0.2s, border-color 0.2s",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>⇪</div>
            <BodyText>Drag and drop CSV/XLSX file here or click to browse</BodyText>
            <MetaText>Expected columns include pair_id, source, spanish_source, english_reference</MetaText>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
            />
          </div>

          {error && <p style={{ color: "var(--danger)", marginTop: 16 }}>{error}</p>}
          {notice && <p style={{ color: "var(--text-secondary)", marginTop: 16 }}>{notice}</p>}
        </Card>
      </Section>

      {fileName && (
        <Section style={{ animationDelay: "100ms" }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <MetaText>File Loaded</MetaText>
              <SecondaryButton onClick={clearAll}>Remove file</SecondaryButton>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
              <div>
                <MetaText>Filename</MetaText>
                <BodyText>{fileName}</BodyText>
              </div>
              <div>
                <MetaText>Pairs loaded</MetaText>
                <BodyText><strong>{rowCount > 0 ? rowCount.toLocaleString() : "Pending backend preview"}</strong></BodyText>
              </div>
              <div>
                <MetaText>Sources</MetaText>
                <BodyText>{sources.length > 0 ? sources.join(", ") : "Unknown (pending preview)"}</BodyText>
              </div>
              <div>
                <MetaText>Reference translations</MetaText>
                <BodyText>{rowCount > 0 ? (hasReference ? "Yes" : "No") : "Unknown"}</BodyText>
              </div>
            </div>

            <MetaText>Rows to analyze</MetaText>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className="ds-btn"
                onClick={() => setRowMode("all")}
                style={{
                  borderColor: rowMode === "all" ? "var(--accent)" : "var(--border)",
                  background: rowMode === "all" ? "var(--accent-soft)" : "transparent",
                  color: rowMode === "all" ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                Entire file {rowCount > 0 ? `(${rowCount.toLocaleString()} rows)` : ""}
              </button>
              <button
                type="button"
                className="ds-btn"
                onClick={() => setRowMode("custom")}
                style={{
                  borderColor: rowMode === "custom" ? "var(--accent)" : "var(--border)",
                  background: rowMode === "custom" ? "var(--accent-soft)" : "transparent",
                  color: rowMode === "custom" ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                Custom number of rows
              </button>
            </div>

            {rowMode === "custom" && (
              <div style={{ marginTop: 12, maxWidth: 320 }}>
                <input
                  type="number"
                  min={1}
                  max={rowCount > 0 ? rowCount : undefined}
                  value={customRowCount}
                  onChange={(e) => setCustomRowCount(e.target.value)}
                  placeholder={rowCount > 0 ? `Enter 1-${rowCount}` : "Enter row count"}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <MetaText>System Prompt</MetaText>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPromptValue(e.target.value)}
                rows={4}
                style={{
                  width: "100%",
                  marginTop: 10,
                  resize: "vertical",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  padding: "12px 14px",
                  fontFamily: "var(--font-system)",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24, alignItems: "center" }}>
              <PrimaryButton disabled={!canContinue} onClick={handleContinue}>Continue to Translate</PrimaryButton>
              <StatusBadge>{rowCount > 0 ? "Ready" : "Accepted"}</StatusBadge>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
