"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Header from "@/components/Header";
import PairDetail from "@/components/PairDetail";
import { pairsToCSVFile, sentenceMetricsToCSVFile, exportResultsCSV, downloadFile } from "@/lib/csv";
import { submitJob, pollUntilDone, fetchJobResults, cancelJob } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT, MODEL_OPTIONS } from "@/lib/types";
import type { JobStatusResponse, JobResults, ClinicalGrade } from "@/lib/types";
import {
  getSessionDataAsync,
  getSessionPrompt,
  getSessionJobId,
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  getSessionModel,
  setSessionJobId,
  setSessionJobResultsAsync,
  setSessionGradesAsync,
  setSessionComparisonResultsAsync,
  getSessionComparisonResultsAsync,
} from "@/lib/session";

type PageState = "idle" | "submitting" | "running" | "complete" | "failed";

/** Throttle partial-result fetches to avoid request pileup. */
const PARTIAL_FETCH_INTERVAL_MS = 6000;

export default function TranslatePage() {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [rowCount, setRowCount] = useState(0);
  const [computeBertscore, setComputeBertscore] = useState(false);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPartialFetchRef = useRef(0);
  const lastOffsetRef = useRef(0);
  const maxTranslatedRef = useRef(0);
  const maxBertCompletedRef = useRef(0);

  const sessionModel = getSessionModel() || MODEL_OPTIONS[0].id;
  const modelLabel = MODEL_OPTIONS.find((m) => m.id === sessionModel)?.label || sessionModel;

  // Restore persisted job results on mount
  useEffect(() => {
    getSessionGradesAsync().then((persisted) => {
      if (persisted) setGrades(persisted);
    });

    getSessionJobResultsAsync().then(async (persisted) => {
      if (persisted && persisted.status === "complete") {
        setJobResults(persisted);
        setPageState("complete");
        setRowCount(persisted.sentence_metrics.length);
      } else if (persisted && persisted.status === "failed") {
        setJobResults(persisted);
        setPageState("failed");
        // Ensure rowCount is set even for failed results
        const data = await getSessionDataAsync();
        setRowCount(
          persisted.sentence_metrics.length || (data ? data.length : 0),
        );
      } else {
        // Read from IDB first (handles large datasets that exceed localStorage)
        const data = await getSessionDataAsync();
        if (data) setRowCount(data.length);
      }

      // Resume polling if a job was in progress
      const jobId = getSessionJobId();
      if (
        jobId &&
        (!persisted || (persisted.status !== "complete" && persisted.status !== "failed"))
      ) {
        resumePolling(jobId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Poll status callback shared by handleRun and resumePolling.
   * Fetches partial results at most once per PARTIAL_FETCH_INTERVAL_MS
   * to prevent request pileup on slow backends.
   */
  const makeStatusCallback = useCallback(
    (jobId: string) =>
      async (status: JobStatusResponse) => {
        if (abortRef.current) return;
        const normalized: JobStatusResponse = {
          ...status,
          translated: Math.max(status.translated, maxTranslatedRef.current),
          bertscore_completed: Math.max(status.bertscore_completed, maxBertCompletedRef.current),
        };
        maxTranslatedRef.current = normalized.translated;
        maxBertCompletedRef.current = normalized.bertscore_completed;

        setJobStatus(normalized);
        setRowCount(normalized.total);

        const now = Date.now();
        if (now - lastPartialFetchRef.current < PARTIAL_FETCH_INTERVAL_MS) return;
        lastPartialFetchRef.current = now;

        try {
          const partial = await fetchJobResults(jobId, lastOffsetRef.current, 500);
          if (partial?.sentence_metrics.length > 0) {
            if (lastOffsetRef.current === 0) {
              setJobResults(partial);
            } else {
              // Merge new results with existing ones
              setJobResults((prev) => {
                if (!prev) return partial;
                return {
                  ...partial,
                  sentence_metrics: [
                    ...prev.sentence_metrics,
                    ...partial.sentence_metrics,
                  ],
                  offset: 0,
                };
              });
            }
            lastOffsetRef.current += partial.sentence_metrics.length;
          }
        } catch {
          // Partial results not yet available — ignore
        }
      },
    [],
  );

  const resumePolling = useCallback(
    async (jobId: string) => {
      setPageState("running");
      abortRef.current = false;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const results = await pollUntilDone(
          jobId,
          makeStatusCallback(jobId),
          2000,
          controller.signal,
        );

        setJobResults(results);
        await setSessionJobResultsAsync(results);
        const isStopped = results.status === "cancelled" || abortRef.current;
        setPageState(
          isStopped ? "complete" : results.status === "complete" ? "complete" : "failed",
        );
      } catch (err) {
        if (!abortRef.current) {
          setError((err as Error).message);
          setPageState("failed");
        }
      }
    },
    [makeStatusCallback],
  );

  // Reference to existing results before a BERTScore-only run, so we can merge
  const preRunResultsRef = useRef<JobResults | null>(null);

  const handleRun = useCallback(async () => {
    const data = await getSessionDataAsync();
    if (!data || data.length === 0) {
      setError("No dataset loaded. Go to Upload to load your CSV first.");
      return;
    }

    setPageState("submitting");
    setError(null);
    setJobResults(null);
    setJobStatus(null);
    preRunResultsRef.current = null;
    abortRef.current = false;
    lastPartialFetchRef.current = 0;
    lastOffsetRef.current = 0;
    maxTranslatedRef.current = 0;
    maxBertCompletedRef.current = 0;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const model = getSessionModel() || MODEL_OPTIONS[0].id;
      const csvFile = pairsToCSVFile(data);

      const { job_id } = await submitJob(csvFile, {
        model,
        systemPrompt,
        temperature: 0,
        maxTokens: 1024,
        computeBertscore,
      });

      setSessionJobId(job_id);
      setRowCount(data.length);
      setPageState("running");

      const results = await pollUntilDone(
        job_id,
        makeStatusCallback(job_id),
        2000,
        controller.signal,
      );

      setJobResults(results);
      await setSessionJobResultsAsync(results);

      // Save to comparison results for head-to-head page
      const existing = (await getSessionComparisonResultsAsync()) || {};
      existing[model] = results;
      await setSessionComparisonResultsAsync(existing);

      const isStopped = results.status === "cancelled" || abortRef.current;
      setPageState(
        isStopped ? "complete" : results.status === "complete" ? "complete" : "failed",
      );

      if (results.status === "failed") {
        setError("Job failed on the backend. Check server logs for details.");
      }
    } catch (err) {
      if (!abortRef.current) {
        setError((err as Error).message);
        setPageState("failed");
      }
    }
  }, [computeBertscore, makeStatusCallback]);

  const handleRunBertscoreOnly = useCallback(async () => {
    if (!jobResults || jobResults.sentence_metrics.length === 0) {
      setError("No translations available. Run translations first.");
      return;
    }

    // Save current results so we can merge BERTScore back in
    preRunResultsRef.current = jobResults;

    setPageState("submitting");
    setError(null);
    setJobStatus(null);
    abortRef.current = false;
    lastPartialFetchRef.current = 0;
    lastOffsetRef.current = 0;
    maxTranslatedRef.current = 0;
    maxBertCompletedRef.current = 0;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const model = getSessionModel() || MODEL_OPTIONS[0].id;
      const csvFile = sentenceMetricsToCSVFile(jobResults.sentence_metrics);

      const { job_id } = await submitJob(csvFile, {
        model,
        systemPrompt,
        temperature: 0,
        maxTokens: 1024,
        computeBertscore: true,
        metricsOnly: true,
      });

      setSessionJobId(job_id);
      setPageState("running");

      const newResults = await pollUntilDone(
        job_id,
        async (status) => {
          if (abortRef.current) return;
          const normalized: JobStatusResponse = {
            ...status,
            translated: Math.max(status.translated, maxTranslatedRef.current),
            bertscore_completed: Math.max(status.bertscore_completed, maxBertCompletedRef.current),
          };
          maxTranslatedRef.current = normalized.translated;
          maxBertCompletedRef.current = normalized.bertscore_completed;
          setJobStatus(normalized);
        },
        2000,
        controller.signal,
      );

      // Merge: keep the previous METEOR/BLEU data and layer in BERTScore
      const prev = preRunResultsRef.current;
      if (prev && newResults.status === "complete") {
        const mergedSentences = prev.sentence_metrics.map((existing) => {
          const fresh = newResults.sentence_metrics.find(
            (s) => s.pair_id === existing.pair_id,
          );
          return {
            ...existing,
            meteor: existing.meteor ?? fresh?.meteor ?? null,
            bertscore_f1: fresh?.bertscore_f1 ?? existing.bertscore_f1 ?? null,
          };
        });

        const mergedResults: JobResults = {
          ...prev,
          sentence_metrics: mergedSentences,
          corpus_metrics: prev.corpus_metrics ?? newResults.corpus_metrics,
          library_versions: newResults.library_versions ?? prev.library_versions,
        };

        setJobResults(mergedResults);
        await setSessionJobResultsAsync(mergedResults);

        const comp = (await getSessionComparisonResultsAsync()) || {};
        comp[model] = mergedResults;
        await setSessionComparisonResultsAsync(comp);
      } else {
        setJobResults(newResults);
        await setSessionJobResultsAsync(newResults);
      }

      preRunResultsRef.current = null;
      const isStopped = newResults.status === "cancelled" || abortRef.current;
      setPageState(
        isStopped ? "complete" : newResults.status === "complete" ? "complete" : "failed",
      );
    } catch (err) {
      if (!abortRef.current) {
        // Restore previous results on error so nothing is lost
        if (preRunResultsRef.current) setJobResults(preRunResultsRef.current);
        preRunResultsRef.current = null;
        setError((err as Error).message);
        setPageState("complete"); // stay in complete so existing data is visible
      }
    }
  }, [jobResults]);

  const handleAbort = useCallback(async () => {
    abortRef.current = true;
    abortControllerRef.current?.abort();

    const jobId = getSessionJobId();
    if (jobId) {
      try { await cancelJob(jobId); } catch { /* best-effort */ }
    }

    if (jobResults) await setSessionJobResultsAsync(jobResults);
    setPageState("complete");
  }, [jobResults]);

  const handleGrade = useCallback(
    (pairId: string, grade: ClinicalGrade) => {
      setGrades((prev) => {
        const next = { ...prev, [pairId]: grade };
        setSessionGradesAsync(next);
        return next;
      });
    },
    [],
  );

  const handleExport = useCallback(() => {
    if (!jobResults) return;
    const csv = exportResultsCSV(jobResults.sentence_metrics, grades);
    downloadFile(csv, "medtranslate_results.csv");
  }, [jobResults, grades]);

  const sentences = jobResults?.sentence_metrics ?? [];
  const completedCount = sentences.filter((s) => s.llm_english_translation && !s.error).length;
  const errorCount = sentences.filter((s) => s.error).length;

  const progressPct = jobStatus && jobStatus.total > 0
    ? (jobStatus.translated / jobStatus.total) * 100
    : 0;

  const bertscorePct = jobStatus && jobStatus.bertscore_total > 0
    ? (jobStatus.bertscore_completed / jobStatus.bertscore_total) * 100
    : 0;
  const isBertscorePhase = !!jobStatus && jobStatus.bertscore_total > 0;

  const hasBertscore = sentences.some((s) => s.bertscore_f1 != null);
  const canRunBertOnly =
    pageState !== "running" && pageState !== "submitting" && completedCount > 0;

  return (
    <div className="page-container">
      <Header />

      {/* Page Header */}
      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          Batch Translation
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{rowCount}</strong> pairs
          {" "}&middot; Model: <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{modelLabel}</strong>
          {pageState === "complete" && <>{" "}&middot; {completedCount} completed &middot; {errorCount} errors</>}
          {pageState === "running" && jobStatus && <>{" "}&middot; {jobStatus.translated} translated</>}
        </p>
      </div>

      {/* Corpus BLEU hero metric */}
      {jobResults?.corpus_metrics && (
        <div className="anim d1" style={{ marginBottom: 48 }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)", maxWidth: 480 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>SacreBLEU (Overall)</div>
            <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
              {jobResults.corpus_metrics.overall.bleu_score.toFixed(2)}
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "var(--warning-light)", color: "var(--warning)", border: "1px solid var(--warning-border)" }}>
              Moderate
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="anim d2 action-bar">
        {/* BERTScore toggle */}
        {(pageState === "idle" || pageState === "complete" || pageState === "failed") && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginRight: 8 }}>
            <input
              type="checkbox"
              checked={computeBertscore}
              onChange={(e) => setComputeBertscore(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Include BERTScore
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }} title="BERTScore requires ~400MB additional memory and uses a RoBERTa model for semantic similarity scoring.">
              (resource-intensive)
            </span>
          </label>
        )}

        {pageState === "idle" || pageState === "complete" || pageState === "failed" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleRun}
              disabled={rowCount === 0}
              style={{
                fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, borderRadius: "var(--radius-sm)",
                padding: "10px 24px", cursor: rowCount === 0 ? "not-allowed" : "pointer",
                background: "var(--accent)", color: "#fff", border: "none",
                opacity: rowCount === 0 ? 0.4 : 1, transition: "all 0.2s",
              }}
            >
              {pageState === "complete" || pageState === "failed" ? "Re-run Translations" : "Run Translations"}
            </button>
            {canRunBertOnly && (
              <button
                onClick={handleRunBertscoreOnly}
                style={{
                  fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, borderRadius: "var(--radius-sm)",
                  padding: "10px 24px", cursor: "pointer",
                  background: "transparent", color: "var(--accent-text)",
                  border: "1px solid var(--accent)", transition: "all 0.2s",
                }}
              >
                {hasBertscore ? "Re-run BERTScore" : "Run BERTScore Only"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ padding: "10px 24px", borderRadius: "var(--radius-sm)", color: "var(--accent-text)", fontSize: 13, fontWeight: 500, border: "1px solid var(--accent)", background: "transparent" }}>
              {pageState === "submitting" ? "Submitting..." : "Running..."}
            </span>
            {pageState === "running" && (
              <button
                onClick={handleAbort}
                style={{
                  fontFamily: "var(--font)", fontSize: 13, fontWeight: 500,
                  padding: "10px 24px", borderRadius: "var(--radius-sm)",
                  color: "var(--danger)", border: "1px solid var(--danger-border)",
                  background: "var(--danger-light)", cursor: "pointer",
                }}
              >
                Stop
              </button>
            )}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={!jobResults || sentences.length === 0}
          style={{
            fontFamily: "var(--font)", fontSize: 13, fontWeight: 500,
            padding: "10px 24px", borderRadius: "var(--radius-sm)",
            background: "transparent", color: "var(--text-secondary)",
            border: "1px solid var(--border)", cursor: !jobResults || sentences.length === 0 ? "not-allowed" : "pointer",
            opacity: !jobResults || sentences.length === 0 ? 0.4 : 1,
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Progress Bar */}
      {(pageState === "running" || pageState === "submitting") && (
        <div className="anim d2" style={{ marginBottom: 24 }}>
          {!(jobStatus && jobStatus.bertscore_total > 0) ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                <span>{jobStatus ? `${jobStatus.translated} of ${jobStatus.total}` : "Submitting job..."}</span>
                <span>{progressPct.toFixed(1)}%</span>
              </div>
              <div style={{ height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                <div className="progress-shimmer" style={{ height: "100%", borderRadius: 100, transition: "width 0.6s ease", width: `${progressPct}%` }} />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Translation complete ({jobStatus.translated} of {jobStatus.total})
            </div>
          )}
          {jobStatus && jobStatus.scored > 0 && jobStatus.bertscore_total === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{jobStatus.scored} metrics computed</div>
          )}
          {/* BERTScore Progress Bar */}
          {jobStatus && jobStatus.bertscore_total > 0 && (
            <div style={{ marginTop: isBertscorePhase ? 0 : 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                <span>BERTScore: {jobStatus.bertscore_completed} of {jobStatus.bertscore_total}</span>
                <span>{bertscorePct.toFixed(1)}%</span>
              </div>
              <div style={{ height: 4, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}>
                <div className="progress-shimmer" style={{ height: "100%", borderRadius: 100, transition: "width 0.6s ease", width: `${bertscorePct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ marginBottom: 20, padding: 16, background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Empty State */}
      {rowCount === 0 && pageState === "idle" && (
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 64, textAlign: "center", boxShadow: "var(--shadow)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 18, marginBottom: 8 }}>No dataset loaded</div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Go to the Upload tab to load your CSV or XLSX first.</p>
        </div>
      )}

      {/* Library versions badge */}
      {jobResults?.library_versions && (
        <div style={{ marginBottom: 20, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", padding: 12, display: "flex", gap: 16, fontSize: 11, color: "var(--text-muted)", boxShadow: "var(--shadow)" }}>
          <span>sacrebleu {jobResults.library_versions.sacrebleu}</span>
          <span>nltk {jobResults.library_versions.nltk}</span>
          {jobResults.library_versions.bert_score && jobResults.library_versions.bert_score !== "not loaded" && (
            <span>bert-score {jobResults.library_versions.bert_score}</span>
          )}
          {jobResults.library_versions.torch && jobResults.library_versions.torch !== "not loaded" && (
            <span>torch {jobResults.library_versions.torch}</span>
          )}
        </div>
      )}

      {/* Results Table */}
      {sentences.length > 0 && (
        <div className="anim d3" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 0, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ maxHeight: 520, overflowX: "auto", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  {["#", "Source", "Source Text (input)", "LLM English (output)", "METEOR", ...(hasBertscore ? ["BERTScore"] : []), "Status"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sentences.slice(0, 200).map((r, i) => {
                  const hasError = !!r.error;
                  const hasTranslation = !!r.llm_english_translation;
                  return (
                    <tr
                      key={`${r.pair_id}-${i}`}
                      onClick={() => setSelectedRow(i)}
                      style={{ cursor: "pointer", background: selectedRow === i ? "var(--accent-soft)" : undefined }}
                    >
                      <td style={{ color: "var(--text-muted)", fontSize: 14 }}>{i + 1}</td>
                      <td>
                        <span
                          className={r.source !== "ClinSpEn_ClinicalCases" ? "badge-dataset-umass" : ""}
                          style={{
                            display: "inline-flex", alignItems: "center",
                            padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600,
                            background: r.source === "ClinSpEn_ClinicalCases" ? "var(--accent-soft)" : undefined,
                            color: r.source === "ClinSpEn_ClinicalCases" ? "var(--accent-text)" : undefined,
                          }}
                        >
                          {r.source === "ClinSpEn_ClinicalCases" ? "ClinSpEn" : r.source === "UMass_EHR" ? "UMass" : r.source}
                        </span>
                      </td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.source_text || r.spanish_source}</td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: hasTranslation ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {r.llm_english_translation || (hasError ? "Failed" : "...")}
                      </td>
                      <td style={{ color: "var(--accent-text)", fontWeight: 600 }}>
                        {r.meteor != null ? r.meteor.toFixed(3) : "--"}
                      </td>
                      {hasBertscore && (
                        <td style={{ color: "var(--accent-text)", fontWeight: 600 }}>
                          {r.bertscore_f1 != null ? r.bertscore_f1.toFixed(3) : "--"}
                        </td>
                      )}
                      <td>
                        <span style={{
                          display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, border: "1px solid",
                          background: hasError ? "var(--danger-light)" : hasTranslation ? "var(--success-light)" : "var(--bg-inset)",
                          color: hasError ? "var(--danger)" : hasTranslation ? "var(--success)" : "var(--text-muted)",
                          borderColor: hasError ? "var(--danger-border)" : hasTranslation ? "var(--success-border)" : "var(--border)",
                        }}>
                          {hasError ? "Error" : hasTranslation ? "Complete" : "Pending"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(jobResults?.total || sentences.length) > 200 && (
              <div style={{ padding: 14, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                Showing first 200 of {jobResults?.total || sentences.length} rows
              </div>
            )}
          </div>
        </div>
      )}

      {selectedRow != null && sentences[selectedRow] && (
        <div style={{ marginTop: 20 }}>
          <PairDetail
            sentence={sentences[selectedRow]}
            grade={grades[sentences[selectedRow].pair_id] ?? null}
            onGrade={(grade) => handleGrade(sentences[selectedRow].pair_id, grade)}
            onClose={() => setSelectedRow(null)}
          />
        </div>
      )}
    </div>
  );
}
