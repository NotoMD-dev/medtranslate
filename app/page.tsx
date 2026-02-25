"use client";

import { useCallback, useRef, useState } from "react";
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
  const [systemPrompt, setSystemPromptValue] = useState(DEFAULT_SYSTEM_PROMPT);

  const processFile = useCallback(async (file: File) => {
    setError("");
    setNotice("");
    setRowMode("all");
    setCustomRowCount("");
    setFileName(file.name);
    setUploadedFile(file);

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
      if (isSpreadsheet) setNotice("XLSX file parsed successfully.");
    } catch (err) {
      if (isSpreadsheet) {
        setRows([]);
        setSessionData(undefined);
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
    setError("");

    let rowLimit: number | undefined;
    if (rowMode === "custom") {
      const parsedCount = Number.parseInt(customRowCount, 10);
      if (!parsedCount || parsedCount < 1) {
        setError("Enter a valid custom row count (minimum 1).");
        return;
      }
      if (rows.length > 0 && parsedCount > rows.length) {
        setError(`Custom row count cannot exceed parsed rows (${rows.length}).`);
        return;
      }
      rowLimit = parsedCount;
    }

    const dataToUse = rowLimit && rows.length > 0 ? rows.slice(0, rowLimit) : rows;
    if (rows.length > 0) {
      setSessionData(dataToUse);
    }
    setSessionPrompt(systemPrompt);
    setSessionRowLimit(rowLimit);
    setSessionJobId(undefined);
    await setSessionJobResultsAsync(undefined);
    router.push("/translate");
  }, [rowMode, customRowCount, rows, systemPrompt, router]);

  const hasPreview = rows.length > 0;
  const sources = Array.from(new Set(rows.map((r) => r.source))).map((src) =>
    src === "ClinSpEn_ClinicalCases" ? "ClinSpEn_ClinicalCases" : "UMass_EHR"
  );
  const hasReference = rows.some((r) => r.english_reference?.trim().length > 0);

  return (
    <>
      <Section>
        <Heading>Upload Dataset</Heading>
        <BodyText>Import a CSV or XLSX with translation pairs, inspect file details, then choose how many rows to analyze.</BodyText>
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
            <MetaText>File Ready</MetaText>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
              <div>
                <MetaText>Filename</MetaText>
                <BodyText>{fileName}</BodyText>
              </div>
              <div>
                <MetaText>Pairs loaded</MetaText>
                <BodyText>{hasPreview ? rows.length.toLocaleString() : "Pending backend preview"}</BodyText>
              </div>
              <div>
                <MetaText>Sources</MetaText>
                <BodyText>{hasPreview ? sources.join(", ") : "Pending preview"}</BodyText>
              </div>
              <div>
                <MetaText>Reference translations</MetaText>
                {hasPreview ? <StatusBadge>{hasReference ? "Yes" : "No"}</StatusBadge> : <StatusBadge>Unknown</StatusBadge>}
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <MetaText>Rows to Analyze</MetaText>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="ds-btn secondary"
                  onClick={() => setRowMode("all")}
                  style={{
                    borderColor: rowMode === "all" ? "var(--accent)" : "var(--border)",
                    color: rowMode === "all" ? "var(--accent-text)" : "var(--text-secondary)",
                    background: rowMode === "all" ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  Entire file {hasPreview ? `(${rows.length.toLocaleString()} rows)` : ""}
                </button>
                <button
                  type="button"
                  className="ds-btn secondary"
                  disabled={!hasPreview}
                  onClick={() => setRowMode("custom")}
                  style={{
                    borderColor: rowMode === "custom" ? "var(--accent)" : "var(--border)",
                    color: rowMode === "custom" ? "var(--accent-text)" : "var(--text-secondary)",
                    background: rowMode === "custom" ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  Custom number of rows
                </button>
              </div>

              {rowMode === "custom" && (
                <div style={{ marginTop: 12 }}>
                  <MetaText>Custom Row Count</MetaText>
                  <input
                    type="number"
                    min={1}
                    max={hasPreview ? rows.length : undefined}
                    placeholder={hasPreview ? `1 - ${rows.length}` : "Requires parsed preview"}
                    value={customRowCount}
                    onChange={(e) => setCustomRowCount(e.target.value)}
                    style={{ width: 260, marginTop: 8 }}
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: 28 }}>
              <MetaText>System Prompt</MetaText>
              <textarea
                rows={4}
                value={systemPrompt}
                onChange={(e) => {
                  setSystemPromptValue(e.target.value);
                  setSessionPrompt(e.target.value);
                }}
                style={{ width: "100%", marginTop: 8, resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <PrimaryButton onClick={handleContinue}>Continue to Translate</PrimaryButton>
              <SecondaryButton onClick={clearAll}>Clear</SecondaryButton>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
