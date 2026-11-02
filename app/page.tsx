"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { parseCSV, detectSourceColumn } from "@/lib/csv";
import { parseFile } from "@/lib/api";
import {
  DEFAULT_SYSTEM_PROMPT,
  SOURCE_LANGUAGES,
  DEFAULT_SOURCE_LANGUAGE,
  MODEL_OPTIONS,
  DEFAULT_MODEL_ID,
  resolveModelId,
  buildSystemPrompt,
} from "@/lib/types";
import {
  clearSessionState,
  getSessionDataAsync,
  getSessionCsvFileName,
  getSessionSourceLanguage,
  getSessionPrompt,
  getSessionModel,
  setSessionDataAsync,
  setSessionPrompt,
  setSessionRowLimit,
  setSessionJobResultsAsync,
  setSessionJobId,
  setSessionCsvFileName,
  setSessionModel,
  setSessionSourceLanguage,
} from "@/lib/session";
import type { TranslationPair } from "@/lib/types";

interface DemoDataset {
  code: string;
  label: string;
  path: string;
  fileName: string;
  rows: number;
}

/** Small synthetic datasets bundled in public/demo (no real patient data). */
const DEMO_DATASETS: DemoDataset[] = [
  { code: "es", label: "Spanish demo", path: "/demo/medtranslate_demo_spanish.csv", fileName: "medtranslate_demo_spanish.csv", rows: 15 },
  { code: "fr", label: "French demo", path: "/demo/medtranslate_demo_french.csv", fileName: "medtranslate_demo_french.csv", rows: 15 },
];

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks the in-flight persistence of a freshly parsed file so that
  // "Continue" can wait for it instead of racing it.
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE.code);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const currentLang = SOURCE_LANGUAGES.find((l) => l.code === sourceLanguage) || DEFAULT_SOURCE_LANGUAGE;
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rowMode, setRowMode] = useState<"all" | "custom" | "range">("all");
  const [customRowCount, setCustomRowCount] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);

  // Restore dataset from session on mount so users can re-use the same dataset
  // for head-to-head model comparison without re-uploading.
  useEffect(() => {
    getSessionDataAsync().then((savedData) => {
      if (!savedData || savedData.length === 0) return;
      setRows(savedData);
      const savedFileName = getSessionCsvFileName();
      if (savedFileName) setFileName(savedFileName);
      const savedLang = getSessionSourceLanguage();
      if (savedLang) setSourceLanguage(savedLang);
      const savedPrompt = getSessionPrompt();
      if (savedPrompt) setSystemPrompt(savedPrompt);
      // Ignore ids of models that are no longer offered (e.g. retired "gpt-4o").
      setSelectedModel(resolveModelId(getSessionModel()));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        parseFile(file, currentLang.columnName)
          .then((parsed) => {
            setRows(parsed);
            pendingSaveRef.current = setSessionDataAsync(parsed).catch(() => {});
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
            const parsed = parseCSV(ev.target?.result as string, currentLang.columnName);
            setRows(parsed);
            pendingSaveRef.current = setSessionDataAsync(parsed).catch(() => {});
            setSessionPrompt(systemPrompt);
            setSessionCsvFileName(file.name);
          } catch (err) {
            setError((err as Error).message);
          }
        };
        reader.readAsText(file);
      }
    },
    [systemPrompt, currentLang.columnName]
  );

  // Load one of the bundled synthetic demo datasets (public/demo/*.csv) so a
  // first-time user can try the whole pipeline without a file of their own.
  const loadDemo = useCallback(
    async (demo: DemoDataset) => {
      setError(null);
      setLoadingDemo(demo.code);
      try {
        const resp = await fetch(demo.path);
        if (!resp.ok) throw new Error(`Could not load demo dataset (${resp.status})`);
        const text = await resp.text();
        const lang = SOURCE_LANGUAGES.find((l) => l.code === demo.code) || DEFAULT_SOURCE_LANGUAGE;
        const parsed = parseCSV(text, lang.columnName);
        const prompt = buildSystemPrompt(lang.label);
        setSourceLanguage(lang.code);
        setSystemPrompt(prompt);
        setRows(parsed);
        setFileName(demo.fileName);
        pendingSaveRef.current = setSessionDataAsync(parsed).catch(() => {});
        setSessionPrompt(prompt);
        setSessionCsvFileName(demo.fileName);
        setSessionSourceLanguage(lang.code);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingDemo(null);
      }
    },
    []
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
    setRangeStart("");
    setRangeEnd("");
    setSourceLanguage(DEFAULT_SOURCE_LANGUAGE.code);
    setSelectedModel(DEFAULT_MODEL_ID);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    pendingSaveRef.current = null;
    clearSessionState();
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }, []);

  const handleContinue = useCallback(async () => {
    let dataToUse: TranslationPair[];

    if (rowMode === "custom") {
      const parsed = parseInt(customRowCount, 10);
      if (!parsed || parsed < 1) {
        setError("Please enter a valid number of rows (1 or more).");
        return;
      }
      dataToUse = rows.slice(0, parsed);
    } else if (rowMode === "range") {
      const start = parseInt(rangeStart, 10);
      const end = parseInt(rangeEnd, 10);
      if (!start || !end || start < 1 || end < start || start > rows.length) {
        setError(`Please enter a valid range (1 - ${rows.length}).`);
        return;
      }
      dataToUse = rows.slice(start - 1, Math.min(end, rows.length));
    } else {
      dataToUse = rows;
    }

    setError(null);
    try {
      // Let any in-flight save of the parsed file finish so it cannot
      // overwrite the (possibly sliced) selection written below.
      if (pendingSaveRef.current) await pendingSaveRef.current;
      pendingSaveRef.current = null;
      // Persist the selection: IndexedDB when available, otherwise
      // localStorage; an in-memory copy always survives the navigation.
      await setSessionDataAsync(dataToUse);
      setSessionPrompt(systemPrompt);
      setSessionRowLimit(dataToUse.length !== rows.length ? dataToUse.length : undefined);
      setSessionModel(selectedModel);
      setSessionSourceLanguage(sourceLanguage);
      // Clear stale results before navigation
      await setSessionJobResultsAsync(undefined);
      setSessionJobId(undefined);
    } catch {
      // Storage problems must never strand the user on this page; the dataset
      // is still held in memory for the Translate page.
    }
    router.push("/translate");
  }, [rowMode, customRowCount, rangeStart, rangeEnd, rows, systemPrompt, selectedModel, sourceLanguage, router]);

  const sources = [...new Set(rows.map((r) => r.source))].filter(Boolean);
  const hasRef = rows.some((r) => r.english_reference);

  const effectiveRowCount = (() => {
    if (rowMode === "custom" && customRowCount) {
      return Math.min(parseInt(customRowCount, 10) || rows.length, rows.length);
    }
    if (rowMode === "range" && rangeStart && rangeEnd) {
      const start = parseInt(rangeStart, 10);
      const end = parseInt(rangeEnd, 10);
      if (start && end && start >= 1 && end >= start) {
        return Math.min(end, rows.length) - Math.max(start, 1) + 1;
      }
    }
    return rows.length;
  })();

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
          Import a CSV/XLSX with clinical translation pairs. Required columns:{" "}
          <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
            {currentLang.columnName}
          </strong>
          {" "}and{" "}
          <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
            english_reference
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
          <>
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
          <div className="demo-row" style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No dataset yet? Try a demo:
            </span>
            {DEMO_DATASETS.map((d) => (
              <button
                key={d.code}
                onClick={() => loadDemo(d)}
                disabled={loadingDemo !== null}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-xs)",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font)",
                  cursor: loadingDemo ? "wait" : "pointer",
                  background: "var(--accent-soft)",
                  color: "var(--accent-text)",
                  border: "1px solid var(--accent)",
                  opacity: loadingDemo && loadingDemo !== d.code ? 0.6 : 1,
                }}
              >
                {loadingDemo === d.code ? "Loading…" : `${d.label} (${d.rows} rows)`}
              </button>
            ))}
            <a
              href="/demo/medtranslate_demo_spanish.csv"
              download
              style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Download the CSV to see the format
            </a>
          </div>
          </>
        ) : (
          <div className="file-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
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
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
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
                flexShrink: 0,
                whiteSpace: "nowrap",
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
              {rowMode === "range" && rangeStart && rangeEnd
                ? `of ${rows.length.toLocaleString()} pairs (rows ${rangeStart}\u2013${Math.min(parseInt(rangeEnd, 10) || rows.length, rows.length)})`
                : rowMode === "custom" && customRowCount
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
          <div className="choice-row">
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
              First N rows
            </button>
            <button
              onClick={() => setRowMode("range")}
              style={{
                flex: 1,
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "all 0.2s",
                background: rowMode === "range" ? "var(--accent-soft)" : "transparent",
                border: `1.5px solid ${rowMode === "range" ? "var(--accent)" : "var(--border)"}`,
                color: rowMode === "range" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              Row range
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
          {rowMode === "range" && (
            <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
              <input
                type="number"
                min="1"
                max={rows.length}
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                placeholder="Start row"
                style={{
                  flex: 1,
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
              <span style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}>to</span>
              <input
                type="number"
                min="1"
                max={rows.length}
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                placeholder="End row"
                style={{
                  flex: 1,
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
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                of {rows.length.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Source Language selector */}
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
            Source Language
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {SOURCE_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setSourceLanguage(lang.code);
                  setSystemPrompt(buildSystemPrompt(lang.label));
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  transition: "all 0.2s",
                  background: sourceLanguage === lang.code ? "var(--accent-soft)" : "transparent",
                  border: `1.5px solid ${sourceLanguage === lang.code ? "var(--accent)" : "var(--border)"}`,
                  color: sourceLanguage === lang.code ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            Your file must contain a <strong style={{ color: "var(--text-secondary)" }}>{currentLang.columnName}</strong> column and an <strong style={{ color: "var(--text-secondary)" }}>english_reference</strong> column.
          </div>
        </div>
      )}

      {/* Model selector */}
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
            LLM Model
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {MODEL_OPTIONS.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  transition: "all 0.2s",
                  background: selectedModel === m.id ? "var(--accent-soft)" : "transparent",
                  border: `1.5px solid ${selectedModel === m.id ? "var(--accent)" : "var(--border)"}`,
                  color: selectedModel === m.id ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                {m.label}
                <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  {m.provider === "openai" ? "OpenAI" : "Anthropic"}
                </span>
              </button>
            ))}
          </div>
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
