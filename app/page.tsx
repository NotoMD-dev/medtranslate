"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCSV } from "@/lib/csv";
import { parseFile } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT, type TranslationPair } from "@/lib/types";
import { clearSessionState, setSessionCsvFileName, setSessionData, setSessionJobId, setSessionJobResultsAsync, setSessionPrompt, setSessionRowLimit } from "@/lib/session";
import { AppContainer, Card, Heading, MetaText, PageContainer, PrimaryButton, Section, Subheading, TabNavigation } from "@/src/design-system";

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    const name = file.name.toLowerCase();
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
    if (!isXlsx && !name.endsWith(".csv")) {
      setError("Unsupported file type. Upload .csv, .xlsx, or .xls.");
      return;
    }
    try {
      let parsed: TranslationPair[];
      if (isXlsx) {
        parsed = await parseFile(file);
      } else {
        const text = await file.text();
        parsed = parseCSV(text);
      }
      setRows(parsed);
      setFileName(file.name);
      setSessionData(parsed);
      setSessionPrompt(DEFAULT_SYSTEM_PROMPT);
      setSessionCsvFileName(file.name);
      setSessionRowLimit(undefined);
      setSessionJobId(undefined);
      setSessionJobResultsAsync(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const sources = [...new Set(rows.map((r) => r.source))].map((s) => (s.includes("UMass") ? "UMass" : "ClinSpEn"));

  return (
    <AppContainer>
      <TabNavigation />
      <PageContainer>
        <Section>
          <Heading>Upload Dataset</Heading>
          <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-muted)" }}>Upload CSV/XLSX with pair_id, source, spanish_source, and english_reference columns.</p>
        </Section>

        <Section>
          <Card>
            <label htmlFor="file-input" style={{ display: "block", border: "2px dashed var(--border)", borderRadius: "var(--radius)", padding: "80px 24px", textAlign: "center", color: "var(--text-secondary)", cursor: "pointer" }}>
              Drag and drop CSV file here or click to browse
            </label>
            <input id="file-input" ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
            {error && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 14 }}>{error}</p>}
          </Card>
        </Section>

        {rows.length > 0 && (
          <Section>
            <Card>
              <Subheading>Upload Summary</Subheading>
              <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                <div><MetaText>Filename</MetaText><div>{fileName}</div></div>
                <div><MetaText>Row Count</MetaText><div>{rows.length}</div></div>
                <div><MetaText>Detected Sources</MetaText><div>{sources.join(", ")}</div></div>
              </div>
              <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                <PrimaryButton onClick={() => router.push("/translate")}>Continue to Translate</PrimaryButton>
                <button onClick={() => { setRows([]); setFileName(null); clearSessionState(); if (fileRef.current) fileRef.current.value = ""; }} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "transparent", padding: "8px 24px", color: "var(--text-secondary)" }}>Clear</button>
              </div>
            </Card>
          </Section>
        )}
      </PageContainer>
    </AppContainer>
  );
}
