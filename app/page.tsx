"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { parseCSV } from "@/lib/csv";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/types";
import type { TranslationPair } from "@/lib/types";

// Global state (would use zustand/context in production)
declare global {
  var __medtranslate_data: TranslationPair[] | undefined;
  var __medtranslate_prompt: string | undefined;
}

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TranslationPair[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target?.result as string);
        setRows(parsed);
        // Store in global for cross-page access
        globalThis.__medtranslate_data = parsed;
        globalThis.__medtranslate_prompt = systemPrompt;
      } catch (err) {
        setError((err as Error).message);
      }
    };
    reader.readAsText(file);
  }, [systemPrompt]);

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

  const sources = [...new Set(rows.map((r) => r.source))].filter(Boolean);
  const hasRef = rows.some((r) => r.english_reference);

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
            CSV with{" "}
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
            background: isDragging ? "rgba(14, 165, 233, 0.05)" : "transparent",
          }}
        >
          <div className="text-5xl text-slate-600 mb-3">+</div>
          <div className="font-semibold text-base text-slate-300">
            Drop CSV here or click to browse
          </div>
          <div className="text-slate-500 text-[13px] mt-1.5">
            Supports unified_translation_dataset.csv format
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
          />
        </div>

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
                {rows.length.toLocaleString()}
              </span>{" "}
              <span className="text-slate-400 text-[13px]">pairs loaded</span>
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
          <div className="mt-8 text-center">
            <button
              onClick={() => router.push("/translate")}
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
