"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { parseCSV, detectColumns, csvHeaders } from "@/lib/csv";
import type { DetectedColumns } from "@/lib/csv";
import { parseFile } from "@/lib/api";
import {
  LANGUAGES,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  MODEL_OPTIONS,
  DEFAULT_MODEL_ID,
  resolveModelId,
  buildSystemPrompt,
  languageLabel,
  sourceColumnFor,
  referenceColumnFor,
} from "@/lib/types";
import {
  clearSessionState,
  getSessionDataAsync,
  getSessionCsvFileName,
  getSessionSourceLanguage,
  getSessionTargetLanguage,
  getSessionModel,
  setSessionDataAsync,
  setSessionPrompt,
  setSessionRowLimit,
  setSessionJobResultsAsync,
  setSessionJobId,
  setSessionCsvFileName,
  setSessionModel,
  setSessionSourceLanguage,
  setSessionTargetLanguage,
} from "@/lib/session";
import type { TranslationPair } from "@/lib/types";

interface DemoDataset {
  source: string;
  target: string;
  label: string;
  path: string;
  fileName: string;
  rows: number;
}

/** Small synthetic datasets bundled in public/demo (no real patient data). */
const DEMO_DATASETS: DemoDataset[] = [
  { source: "es", target: "en", label: "Spanish \u2192 English demo", path: "/demo/medtranslate_demo_spanish.csv", fileName: "medtranslate_demo_spanish.csv", rows: 15 },
  { source: "fr", target: "en", label: "French \u2192 English demo", path: "/demo/medtranslate_demo_french.csv", fileName: "medtranslate_demo_french.csv", rows: 15 },
  { source: "en", target: "es", label: "English \u2192 Spanish demo", path: "/demo/medtranslate_demo_english_to_spanish.csv", fileName: "medtranslate_demo_english_to_spanish.csv", rows: 15 },
];

const CODE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "0.92em",
  color: "var(--text-secondary)",
  background: "var(--bg-inset)",
  padding: "1px 5px",
  borderRadius: 4,
};

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks the in-flight persistence of a freshly parsed file so that
  // "Continue" can wait for it instead of racing it.
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE.code);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE.code);
  // What the uploaded file's column names said about the direction, if anything.
  const [detected, setDetected] = useState<DetectedColumns | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  // The instruction is derived from the direction (it is read-only below).
  const systemPrompt = useMemo(() => buildSystemPrompt(sourceLanguage, targetLanguage), [sourceLanguage, targetLanguage]);
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
      const savedTarget = getSessionTargetLanguage();
      if (savedTarget) setTargetLanguage(savedTarget);
      // Ignore ids of models that are no longer offered (e.g. retired "gpt-4o").
      setSelectedModel(resolveModelId(getSessionModel()));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Record a parsed file: keep the rows, and take the translation direction
   * from the column names when they carry one (spanish_source +
   * english_reference says Spanish to English). Generic columns leave the
   * current picks alone.
   */
  const acceptParsed = useCallback(
    (parsed: TranslationPair[], cols: DetectedColumns, name: string) => {
      let src = cols.sourceLanguage ?? sourceLanguage;
      let tgt = cols.targetLanguage ?? targetLanguage;
      if (src === tgt) {
        // Only one side came from the file and it collides with the other pick.
        if (cols.sourceLanguage) tgt = src === "en" ? "es" : "en";
        else src = tgt === "en" ? "es" : "en";
      }
      setDetected(cols);
      setSourceLanguage(src);
      setTargetLanguage(tgt);
      setRows(parsed);
      setFileName(name);
      pendingSaveRef.current = setSessionDataAsync(parsed).catch(() => {});
      setSessionPrompt(buildSystemPrompt(src, tgt));
      setSessionCsvFileName(name);
      setSessionSourceLanguage(src);
      setSessionTargetLanguage(tgt);
    },
    [sourceLanguage, targetLanguage]
  );

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
        // Send XLSX to backend for safe parsing with openpyxl. The backend
        // reads the direction from the column names too.
        parseFile(file)
          .then(({ rows: parsed, columns }) => acceptParsed(parsed, columns, file.name))
          .catch((err) => {
            setError((err as Error).message);
          });
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const text = ev.target?.result as string;
            const cols = detectColumns(csvHeaders(text));
            const parsed = parseCSV(text, cols);
            acceptParsed(parsed, cols, file.name);
          } catch (err) {
            setError((err as Error).message);
          }
        };
        reader.readAsText(file);
      }
    },
    [acceptParsed]
  );

  // Load one of the bundled synthetic demo datasets (public/demo/*.csv) so a
  // first-time user can try the whole pipeline without a file of their own.
  const loadDemo = useCallback(
    async (demo: DemoDataset) => {
      setError(null);
      setLoadingDemo(demo.fileName);
      try {
        const resp = await fetch(demo.path);
        if (!resp.ok) throw new Error(`Could not load demo dataset (${resp.status})`);
        const text = await resp.text();
        const cols = detectColumns(csvHeaders(text));
        const parsed = parseCSV(text, cols);
        acceptParsed(parsed, cols, demo.fileName);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingDemo(null);
      }
    },
    [acceptParsed]
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
    setTargetLanguage(DEFAULT_TARGET_LANGUAGE.code);
    setDetected(null);
    setSelectedModel(DEFAULT_MODEL_ID);
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
      setSessionTargetLanguage(targetLanguage);
      // Clear stale results before navigation
      await setSessionJobResultsAsync(undefined);
      setSessionJobId(undefined);
    } catch {
      // Storage problems must never strand the user on this page; the dataset
      // is still held in memory for the Translate page.
    }
    router.push("/translate");
  }, [rowMode, customRowCount, rangeStart, rangeEnd, rows, systemPrompt, selectedModel, sourceLanguage, targetLanguage, router]);

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
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
          Import a CSV/XLSX with clinical translation pairs. Name the two text columns after their languages:{" "}
          <code style={CODE}>&lt;language&gt;_source</code> for the text to translate and{" "}
          <code style={CODE}>&lt;language&gt;_reference</code> for the human translation to score against.
          For example <code style={CODE}>spanish_source</code> + <code style={CODE}>english_reference</code> translates Spanish into English, and{" "}
          <code style={CODE}>english_source</code> + <code style={CODE}>spanish_reference</code> translates English into Spanish.
          The app reads the direction from the column names.
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
                key={d.fileName}
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
                  opacity: loadingDemo && loadingDemo !== d.fileName ? 0.6 : 1,
                }}
              >
                {loadingDemo === d.fileName ? "Loading…" : `${d.label} (${d.rows} rows)`}
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

      {/* Translation direction */}
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
            Translation Direction
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          {detected && detected.sourceLanguage && detected.targetLanguage ? (
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-secondary)" }}>
              Detected from the column names: <strong style={{ color: "var(--accent-text)" }}>{languageLabel(detected.sourceLanguage)} &rarr; {languageLabel(detected.targetLanguage)}</strong>
              {" "}(<code style={CODE}>{detected.sourceColumn}</code> &rarr; <code style={CODE}>{detected.referenceColumn}</code>).
            </div>
          ) : (
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-secondary)" }}>
              The file uses generic column names
              {detected?.sourceColumn && detected?.referenceColumn && (
                <> (<code style={CODE}>{detected.sourceColumn}</code> &rarr; <code style={CODE}>{detected.referenceColumn}</code>)</>
              )}
              , so pick the direction here.
            </div>
          )}
          {(["from", "into"] as const).map((side) => {
            const value = side === "from" ? sourceLanguage : targetLanguage;
            const other = side === "from" ? targetLanguage : sourceLanguage;
            const setValue = side === "from" ? setSourceLanguage : setTargetLanguage;
            return (
              <div key={side} style={{ marginBottom: side === "from" ? 14 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                  {side === "from" ? "Translate from" : "Translate into"}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {LANGUAGES.map((lang) => {
                    const active = value === lang.code;
                    const blocked = other === lang.code;
                    return (
                      <button
                        key={lang.code}
                        onClick={() => !blocked && setValue(lang.code)}
                        disabled={blocked}
                        title={blocked ? `Already selected as the ${side === "from" ? "target" : "source"} language` : undefined}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "var(--radius-sm)",
                          fontSize: 14,
                          fontWeight: 500,
                          cursor: blocked ? "not-allowed" : "pointer",
                          fontFamily: "var(--font)",
                          transition: "all 0.2s",
                          opacity: blocked ? 0.35 : 1,
                          background: active ? "var(--accent-soft)" : "transparent",
                          border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                          color: active ? "var(--accent-text)" : "var(--text-secondary)",
                        }}
                      >
                        {lang.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {detected && detected.sourceLanguage && detected.targetLanguage &&
            (detected.sourceLanguage !== sourceLanguage || detected.targetLanguage !== targetLanguage) && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--warning-light)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-xs)", color: "var(--warning)", fontSize: 12, lineHeight: 1.5 }}>
              The file&rsquo;s column names say {languageLabel(detected.sourceLanguage)} &rarr; {languageLabel(detected.targetLanguage)}. The model will be told to translate {languageLabel(sourceLanguage)} into {languageLabel(targetLanguage)} and the scores will be computed for {languageLabel(targetLanguage)}.
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Translating <strong style={{ color: "var(--text-secondary)" }}>{languageLabel(sourceLanguage)}</strong> into <strong style={{ color: "var(--text-secondary)" }}>{languageLabel(targetLanguage)}</strong>: the expected columns are <code style={CODE}>{sourceColumnFor(sourceLanguage)}</code> and <code style={CODE}>{referenceColumnFor(targetLanguage)}</code>. Scores compare the model&rsquo;s {languageLabel(targetLanguage)} against the {languageLabel(targetLanguage)} reference.
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
