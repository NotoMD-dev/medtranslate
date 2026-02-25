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
import { Card, ElevatedCard, SoftCard, Heading, MetaText, BodyText, PrimaryButton, SecondaryButton, Section, StatusBadge, AccentBadge } from "@/src/design-system";

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setError("");
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    const isSpreadsheet = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    const isCSV = lower.endsWith(".csv");

    if (!isSpreadsheet && !isCSV) {
      setError("Unsupported file type. Please upload a .csv, .xlsx, or .xls file.");
      return;
    }

    try {
      const parsed = isSpreadsheet ? await parseFile(file) : parseCSV(await file.text());
      setRows(parsed);
      setSessionData(parsed);
      setSessionPrompt(DEFAULT_SYSTEM_PROMPT);
      setSessionCsvFileName(file.name);
      setSessionRowLimit(undefined);
      setSessionJobId(undefined);
      await setSessionJobResultsAsync(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  return (
    <>
      <Section>
        <Heading>Upload Dataset</Heading>
        <BodyText>Import a CSV or Excel dataset for clinical translation review. Required column: <strong>spanish_source</strong>.</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
        <div className="ds-grid two">
          <ElevatedCard>
            <MetaText>Dataset Import</MetaText>
            <BodyText>Supports <strong>.csv</strong>, <strong>.xlsx</strong>, and <strong>.xls</strong>. Excel parsing uses the backend parser so your column names stay consistent.</BodyText>
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <AccentBadge>Clinical-grade ingestion</AccentBadge>
              <AccentBadge>Column validation</AccentBadge>
            </div>
            <SoftCard>
              <MetaText>Expected fields</MetaText>
              <BodyText>pair_id, source, content_type, english_reference, spanish_source</BodyText>
            </SoftCard>
          </ElevatedCard>
          <Card>
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
              background: isDragging ? "var(--accent-soft)" : "transparent",
              borderRadius: "var(--radius)",
              padding: "80px 24px",
              textAlign: "center",
              cursor: "pointer",
              transition: "background 0.2s, border-color 0.2s",
            }}
          >
            <BodyText>Drag and drop CSV/XLSX file here or click to browse.</BodyText>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
            />
          </div>
          {error && <p style={{ color: "var(--danger)", marginTop: 16 }}>{error}</p>}
          </Card>
        </div>
      </Section>

      {rows.length > 0 && (
        <Section style={{ animationDelay: "100ms" }}>
          <Card>
            <MetaText>Upload complete</MetaText>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <BodyText><strong>Filename:</strong> {fileName}</BodyText>
              <BodyText><strong>Row count:</strong> {rows.length}</BodyText>
              <BodyText><strong>Detected columns:</strong> pair_id, source, content_type, english_reference, spanish_source</BodyText>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <PrimaryButton onClick={() => router.push("/translate")}>Continue to Translate</PrimaryButton>
              <SecondaryButton onClick={() => { setRows([]); setFileName(""); setError(""); clearSessionState(); }}>
                Clear
              </SecondaryButton>
              <StatusBadge>{rows.length} rows ready</StatusBadge>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
