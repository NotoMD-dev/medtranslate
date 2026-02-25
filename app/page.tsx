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
import { Card, Heading, MetaText, BodyText, PrimaryButton, Section, StatusBadge } from "@/src/design-system";

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
    try {
      const isSpreadsheet = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
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
        <BodyText>Import a CSV/XLSX with clinical translation pairs. Required column: <strong>spanish_source</strong>.</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
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
            <BodyText>Drag and drop CSV file here or click to browse.</BodyText>
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
              <button className="ds-btn secondary" onClick={() => { setRows([]); setFileName(""); setError(""); clearSessionState(); }}>
                Clear
              </button>
              <StatusBadge>{rows.length} rows ready</StatusBadge>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
