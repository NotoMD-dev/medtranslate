"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { parseCSV, parseXLSX } from "@/lib/csv";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import type { TranslationPair } from "@/lib/types";

// Global state (would use zustand/context in production)
declare global {
  var __medtranslate_data: TranslationPair[] | undefined;
  var __medtranslate_prompt: string | undefined;
  var __medtranslate_rowLimit: number | undefined;
  var __medtranslate_results: import("@/lib/types").TranslationResult[] | undefined;
}

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
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const buffer = ev.target?.result as ArrayBuffer;
            const parsed = parseXLSX(buffer);
            setRows(parsed);
            globalThis.__medtranslate_data = parsed;
            globalThis.__medtranslate_prompt = systemPrompt;
          } catch (err) {
            setError((err as Error).message);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = parseCSV(ev.target?.result as string);
            setRows(parsed);
            globalThis.__medtranslate_data = parsed;
            globalThis.__medtranslate_prompt = systemPrompt;
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
    globalThis.__medtranslate_data = undefined;
    globalThis.__medtranslate_prompt = undefined;
    globalThis.__medtranslate_rowLimit = undefined;
    globalThis.__medtranslate_results = undefined;
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
    globalThis.__medtranslate_data = dataToUse;
    globalThis.__medtranslate_prompt = systemPrompt;
    globalThis.__medtranslate_rowLimit = limit;
    router.push("/translate");
  }, [rowMode, customRowCount, rows, systemPrompt, router]);

  const sources = [...new Set(rows.map((r) => r.source))].filter(Boolean);
  const hasRef = rows.some((r) => r.english_reference);

  const effectiveRowCount =
    rowMode === "custom" && customRowCount
      ? Math.min(parseInt(customRowCount, 10) || rows.length, rows.length)
      : rows.length;

  return (
    <div className="min-h-screen">
      <Header />
      <div className="max-w-2xl mx-auto px-8 pt-16">
        {/* Title */}
        <div className="text-center mb-10">
          <h1 className="text-[32px] font-light text-slate-100 tracking-tight">
            Upload your{" "}
            <span
              className="font-bold"
              style={{
                background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              translation dataset
            </span>
          </h1>
          <p className="mt-2.5 text-slate-500 text-[15px]">
            CSV or XLSX with{" "}
            <code className="bg-surface-700 px-2 py-0.5 rounded text-[13px] font-mono">
              spanish_source
            </code>{" "}
            and optional{" "}
            <code className="bg-surface-700 px-2 py-0.5 rounded text-[13px] font-mono">
              english_reference
            </code>{" "}
            columns
          </p>
        </div>

        {/* Drop zone */}
        {rows.length === 0 ? (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className="w-full rounded-2xl p-14 text-center cursor-pointer transition-colors"
            style={{
              border: `2px dashed ${isDragging ? "#0ea5e9" : "#334155"}`,
              background: isDragging
                ? "rgba(14, 165, 233, 0.05)"
                : "transparent",
            }}
          >
            <div className="text-5xl text-slate-600 mb-3">+</div>
            <div className="font-semibold text-base text-slate-300">
              Drop CSV or XLSX here or click to browse
            </div>
            <div className="text-slate-500 text-[13px] mt-1.5">
              Supports .csv and .xlsx file formats
            </div>
          </div>
        ) : (
          /* File loaded state with delete option */
          <div
            className="w-full rounded-2xl p-6 transition-colors"
            style={{ border: "2px solid #334155" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-[18px]"
                  style={{ background: "rgba(14, 165, 233, 0.15)" }}
                >
                  <span style={{ color: "#0ea5e9" }}>
                    {fileName?.endsWith(".xlsx") || fileName?.endsWith(".xls")
                      ? "XL"
                      : "CSV"}
                  </span>
                </div>
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    {fileName}
                  </div>
                  <div className="text-slate-500 text-[12px]">
                    {rows.length.toLocaleString()} rows loaded
                  </div>
                </div>
              </div>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg text-red-400 text-[13px] font-semibold border border-red-500/30 bg-transparent cursor-pointer hover:bg-red-500/10 transition-colors"
              >
                Remove file
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleUpload}
          className="hidden"
        />

        {error && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Dataset stats */}
        {rows.length > 0 && (
          <div className="mt-6 bg-surface-700 rounded-xl p-4 flex items-center gap-8">
            <div>
              <span className="text-accent-blue font-bold text-2xl font-mono">
                {effectiveRowCount.toLocaleString()}
              </span>{" "}
              <span className="text-slate-400 text-[13px]">
                {rowMode === "custom" && customRowCount
                  ? `of ${rows.length.toLocaleString()} pairs selected`
                  : "pairs loaded"}
              </span>
            </div>
            <div className="w-px h-8 bg-surface-600" />
            <div className="text-[13px] text-slate-400">
              Sources: {sources.join(", ") || "N/A"}
            </div>
            <div className="w-px h-8 bg-surface-600" />
            <div className="text-[13px] text-slate-400">
              Reference translations: {hasRef ? "Yes" : "No"}
            </div>
          </div>
        )}

        {/* Row limit option */}
        {rows.length > 0 && (
          <div className="mt-6">
            <label className="text-[12px] font-semibold text-slate-400 tracking-wider block mb-3">
              ROWS TO ANALYZE
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setRowMode("all")}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                style={{
                  background:
                    rowMode === "all"
                      ? "rgba(14, 165, 233, 0.15)"
                      : "transparent",
                  border: `1.5px solid ${rowMode === "all" ? "#0ea5e9" : "#334155"}`,
                  color: rowMode === "all" ? "#0ea5e9" : "#94a3b8",
                }}
              >
                Entire file ({rows.length.toLocaleString()} rows)
              </button>
              <button
                onClick={() => setRowMode("custom")}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                style={{
                  background:
                    rowMode === "custom"
                      ? "rgba(14, 165, 233, 0.15)"
                      : "transparent",
                  border: `1.5px solid ${rowMode === "custom" ? "#0ea5e9" : "#334155"}`,
                  color: rowMode === "custom" ? "#0ea5e9" : "#94a3b8",
                }}
              >
                Custom number of rows
              </button>
            </div>
            {rowMode === "custom" && (
              <div className="mt-3">
                <input
                  type="number"
                  min="1"
                  max={rows.length}
                  value={customRowCount}
                  onChange={(e) => setCustomRowCount(e.target.value)}
                  placeholder={`Enter number (1 - ${rows.length.toLocaleString()})`}
                  className="w-full bg-surface-700 border border-surface-600 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:outline-none focus:border-accent-blue placeholder:text-slate-600"
                />
              </div>
            )}
          </div>
        )}

        {/* System prompt */}
        <div className="mt-8">
          <label className="text-[12px] font-semibold text-slate-400 tracking-wider block mb-2">
            SYSTEM PROMPT
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              globalThis.__medtranslate_prompt = e.target.value;
            }}
            className="w-full h-28 bg-surface-700 border border-surface-600 rounded-xl p-4 text-slate-200 text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-accent-blue"
          />
        </div>

        {/* Start button */}
        {rows.length > 0 && (
          <div className="mt-8 text-center pb-16">
            <button
              onClick={handleContinue}
              className="px-10 py-3 rounded-xl text-white font-bold text-[15px] border-none cursor-pointer hover:opacity-90"
              style={{
                background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              }}
            >
              Continue to Translation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
