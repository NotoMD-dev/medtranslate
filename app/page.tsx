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

  const processFile = useCallback(async (file: File) => {
    setError("");
    setNotice("");
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
      setSessionPrompt(DEFAULT_SYSTEM_PROMPT);
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
        setNotice("XLSX file accepted. Preview is unavailable until backend parse is reachable, but you can continue to Translate.");
      } else {
        setError((err as Error).message);
      }
    }
  }, []);

  const clearAll = useCallback(() => {
    setRows([]);
    setFileName("");
    setError("");
    setNotice("");
    clearSessionState();
    clearUploadedFile();
  }, []);

  const canContinue = Boolean(fileName);

  return (
    <>
      <Section>
        <Heading>Upload Dataset</Heading>
        <BodyText>Import a CSV or XLSX dataset for translation and clinical review workflows.</BodyText>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginTop: 16 }}>
              <div>
                <MetaText>Filename</MetaText>
                <BodyText>{fileName}</BodyText>
              </div>
              <div>
                <MetaText>Parsed rows</MetaText>
                <BodyText>{rows.length ? rows.length : "Pending backend preview"}</BodyText>
              </div>
              <div>
                <MetaText>Status</MetaText>
                <StatusBadge>{rows.length ? "Ready" : "Accepted"}</StatusBadge>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <PrimaryButton disabled={!canContinue} onClick={() => router.push("/translate")}>Continue to Translate</PrimaryButton>
              <SecondaryButton onClick={clearAll}>Clear</SecondaryButton>
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
