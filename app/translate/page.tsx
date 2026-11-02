"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Header from "@/components/Header";
import PairDetail from "@/components/PairDetail";
import { pairsToCSVFile, sentenceMetricsToCSVFile, exportResultsCSV, downloadFile } from "@/lib/csv";
import { submitJob, pollUntilDone, fetchJobResults, fetchAllJobResultsPaginated, cancelJob } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT, MODEL_OPTIONS, resolveModelId, modelLabel as labelForModel } from "@/lib/types";
import { countRun, isIncomplete, isRefused, applyRefusalOverrides, rowStatus, bleuBand, bandStyle, SMALL_SAMPLE_THRESHOLD } from "@/lib/metrics";
import type { JobStatusResponse, JobResults, ClinicalGrade, SentenceMetrics, RefusalOverride } from "@/lib/types";
import {
  getSessionDataAsync,
  getSessionPrompt,
  getSessionJobId,
  getSessionJobResultsAsync,
  getSessionGradesAsync,
  getSessionModel,
  setSessionModel,
  setSessionJobId,
  setSessionJobResultsAsync,
  setSessionGradesAsync,
  setSessionComparisonResultsAsync,
  getSessionComparisonResultsAsync,
  getSessionRefusalOverrides,
} from "@/lib/session";

type PageState = "idle" | "submitting" | "running" | "complete" | "failed";

/**
 * How often the table is refreshed from the backend while a job runs. Small
 * jobs refresh often (one request each); large ones less often, because each
 * refresh re-fetches every row so scores can fill in as they are computed.
 */
const REFRESH_INTERVAL_SMALL_MS = 3000;
const REFRESH_INTERVAL_LARGE_MS = 8000;
const LARGE_JOB_ROWS = 1500;

/** Progress-bar label and percentage for the backend's current phase. */
function describeProgress(
  status: JobStatusResponse | null,
  submitting: boolean,
): { label: string; pct: number | null } {
  if (!status) return { label: submitting ? "Submitting job\u2026" : "Starting\u2026", pct: null };
  const total = status.total || 0;
  switch (status.phase) {
    case "queued":
      return { label: "Waiting for a worker\u2026", pct: null };
    case "translating":
      return { label: `Translating ${status.translated} of ${total}`, pct: total ? (status.translated / total) * 100 : null };
    case "meteor": {
      const scorable = Math.max(0, total - (status.incomplete_rows ?? 0));
      return { label: `Scoring METEOR ${status.scored} of ${scorable}`, pct: scorable ? (status.scored / scorable) * 100 : null };
    }
    case "bleu":
      return { label: "Computing corpus BLEU\u2026", pct: null };
    case "bertscore":
      return status.bertscore_total > 0
        ? { label: `Computing BERTScore ${status.bertscore_completed} of ${status.bertscore_total}`, pct: (status.bertscore_completed / status.bertscore_total) * 100 }
        : { label: "Loading the BERTScore model\u2026", pct: null };
    case "complete":
      return { label: "Finishing\u2026", pct: 100 };
    default:
      return { label: `${status.translated} of ${total} translated`, pct: total ? (status.translated / total) * 100 : null };
  }
}

export default function TranslatePage() {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [rowCount, setRowCount] = useState(0);
  const [restoringSession, setRestoringSession] = useState(true);
  const [computeBertscore, setComputeBertscore] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, RefusalOverride>>({});
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPartialFetchRef = useRef(0);
  // Set from ?autorun=1 (used by the Compare page's "translate with the other
  // model" button); consumed once the dataset is restored.
  const autorunRef = useRef(false);

  const sessionModel = resolveModelId(getSessionModel());
  const modelLabel = labelForModel(sessionModel);

  // Restore persisted job results on mount
  useEffect(() => {
    // ?model=<id>&autorun=1 lets the Compare page start a run for the other
    // model in one click. The parameters are consumed and removed.
    if (typeof window !== "undefined" && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("model");
      if (wanted && MODEL_OPTIONS.some((m) => m.id === wanted)) setSessionModel(wanted);
      if (params.get("autorun") === "1") autorunRef.current = true;
      if (wanted || params.get("autorun")) window.history.replaceState(null, "", "/translate");
    }
    setOverrides(getSessionRefusalOverrides());
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
    }).finally(() => setRestoringSession(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Poll status callback shared by handleRun and resumePolling.
   * Fetches partial results at most once per PARTIAL_FETCH_INTERVAL_MS
   * to prevent request pileup on slow backends.
   */
  /**
   * Poll status callback shared by every job flow. Besides the counters, it
   * periodically re-fetches the whole result set so translations, METEOR and
   * BERTScore values appear in the table as the backend fills them in.
   */
  const makeStatusCallback = useCallback(
    (jobId: string) =>
      async (status: JobStatusResponse) => {
        if (abortRef.current) return;
        setJobStatus(status);
        setRowCount(status.total);

        const now = Date.now();
        const interval = status.total > LARGE_JOB_ROWS ? REFRESH_INTERVAL_LARGE_MS : REFRESH_INTERVAL_SMALL_MS;
        if (now - lastPartialFetchRef.current < interval) return;
        lastPartialFetchRef.current = now;

        try {
          const partial = status.total > LARGE_JOB_ROWS
            ? await fetchAllJobResultsPaginated(jobId)
            : await fetchJobResults(jobId);
          if (partial?.sentence_metrics.length > 0) setJobResults(partial);
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
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const model = resolveModelId(getSessionModel());
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

  // Start automatically when arriving from the Compare page's one-click
  // "translate with the other model" button, once the dataset is restored.
  useEffect(() => {
    if (!autorunRef.current || restoringSession || rowCount === 0) return;
    if (pageState === "running" || pageState === "submitting") return;
    autorunRef.current = false;
    handleRun();
  }, [restoringSession, rowCount, pageState, handleRun]);

  // -------------------------------------------------------------------------
  // Shared job helpers. BERTScore-only, retry, and reviewer-override flows
  // all end in the same "re-score everything in metrics-only mode" step; the
  // backend's metric cache makes that step cheap for rows scored before.
  // -------------------------------------------------------------------------

  /** Reset page state for a new job and return its AbortController. */
  const beginRun = useCallback(() => {
    setPageState("submitting");
    setError(null);
    setJobStatus(null);
    abortRef.current = false;
    lastPartialFetchRef.current = 0;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }, []);

  /**
   * Submit rows as a metrics-only job (translations and failure statuses are
   * carried over; nothing is re-translated) and wait for it to finish.
   */
  const runMetricsOnly = useCallback(
    async (rows: SentenceMetrics[], withBert: boolean, signal: AbortSignal): Promise<JobResults> => {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const model = resolveModelId(getSessionModel());
      const { job_id } = await submitJob(sentenceMetricsToCSVFile(rows, "rescore.csv", true), {
        model, systemPrompt, temperature: 0, maxTokens: 1024, computeBertscore: withBert, metricsOnly: true,
      });
      setSessionJobId(job_id);
      setRowCount(rows.length);
      setPageState("running");
      return pollUntilDone(job_id, makeStatusCallback(job_id), 2000, signal);
    },
    [makeStatusCallback],
  );

  /** Persist a finished result set everywhere the other pages read it. */
  const commitResults = useCallback(async (results: JobResults) => {
    setJobResults(results);
    setRowCount(results.sentence_metrics.length);
    await setSessionJobResultsAsync(results);
    const model = resolveModelId(getSessionModel());
    const comp = (await getSessionComparisonResultsAsync()) || {};
    comp[model] = results;
    await setSessionComparisonResultsAsync(comp);
  }, []);

  /** Re-score the given rows and replace the current results, keeping the original translation config. */
  const rescore = useCallback(
    async (rows: SentenceMetrics[], withBert: boolean, failureMessage: string) => {
      const prev = jobResults;
      if (!prev) return;
      preRunResultsRef.current = prev;
      const controller = beginRun();
      try {
        const fresh = await runMetricsOnly(rows, withBert, controller.signal);
        if (fresh.status === "complete") {
          await commitResults({ ...fresh, translation_config: prev.translation_config ?? fresh.translation_config });
        } else {
          setJobResults(prev);
          if (!abortRef.current) setError(failureMessage);
        }
      } catch (err) {
        if (!abortRef.current) {
          setJobResults(prev);
          setError((err as Error).message);
        }
      } finally {
        preRunResultsRef.current = null;
        setPageState("complete");
      }
    },
    [jobResults, beginRun, runMetricsOnly, commitResults],
  );

  const handleRunBertscoreOnly = useCallback(async () => {
    if (!jobResults || jobResults.sentence_metrics.length === 0) {
      setError("No translations available. Run translations first.");
      return;
    }
    await rescore(applyRefusalOverrides(jobResults.sentence_metrics, overrides), true, "BERTScore run did not complete.");
  }, [jobResults, overrides, rescore]);

  /** Re-score so reviewer refusal overrides are excluded from corpus BLEU as well. */
  const handleApplyOverrides = useCallback(async () => {
    if (!jobResults) return;
    const keepBert = jobResults.sentence_metrics.some((s) => s.bertscore_f1 != null);
    await rescore(applyRefusalOverrides(jobResults.sentence_metrics, overrides), keepBert, "Re-score did not complete.");
  }, [jobResults, overrides, rescore]);

  /**
   * Retry only rows that failed for infrastructure reasons. Refusals are model
   * behaviour and are not retried. Translate the incomplete rows as a fresh
   * job, merge by pair_id, then re-score everything together so corpus BLEU
   * and the averages cover every row.
   */
  const handleRetryIncomplete = useCallback(async () => {
    if (!jobResults) return;
    const incomplete = jobResults.sentence_metrics.filter(isIncomplete);
    if (incomplete.length === 0) return;
    const prev = jobResults;
    preRunResultsRef.current = prev;
    const controller = beginRun();
    try {
      const systemPrompt = getSessionPrompt() || DEFAULT_SYSTEM_PROMPT;
      const model = resolveModelId(getSessionModel());
      const keepBert = prev.sentence_metrics.some((s) => s.bertscore_f1 != null);

      const { job_id } = await submitJob(sentenceMetricsToCSVFile(incomplete, "retry.csv", false), {
        model, systemPrompt, temperature: 0, maxTokens: 1024, computeBertscore: false,
      });
      setSessionJobId(job_id);
      setRowCount(incomplete.length);
      setPageState("running");
      const retried = await pollUntilDone(job_id, makeStatusCallback(job_id), 2000, controller.signal);

      const fresh = new Map(retried.sentence_metrics.map((s) => [s.pair_id, s]));
      const merged = prev.sentence_metrics.map((s) => (fresh.has(s.pair_id) ? { ...s, ...fresh.get(s.pair_id)! } : s));
      const recovered = retried.sentence_metrics.filter((s) => s.llm_english_translation).length;

      let finalResults: JobResults = { ...prev, sentence_metrics: merged };
      if (recovered > 0) {
        const rescored = await runMetricsOnly(applyRefusalOverrides(merged, overrides), keepBert, controller.signal);
        if (rescored.status === "complete") {
          finalResults = { ...rescored, translation_config: prev.translation_config ?? rescored.translation_config };
        }
      }
      await commitResults(finalResults);
      if (recovered < incomplete.length) {
        setError(`${incomplete.length - recovered} of ${incomplete.length} retried rows failed again. You can retry once the provider recovers.`);
      }
    } catch (err) {
      if (!abortRef.current) {
        setJobResults(prev);
        setRowCount(prev.sentence_metrics.length);
        setError((err as Error).message);
      }
    } finally {
      preRunResultsRef.current = null;
      setPageState("complete");
    }
  }, [jobResults, overrides, beginRun, runMetricsOnly, commitResults, makeStatusCallback]);

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
    const rows = applyRefusalOverrides(jobResults.sentence_metrics, overrides);
    const csv = exportResultsCSV(rows, grades, undefined, overrides);
    downloadFile(csv, "medtranslate_results.csv");
  }, [jobResults, grades, overrides]);

  const rawSentences = jobResults?.sentence_metrics ?? [];
  // Reviewer refusal overrides are applied for display. The stored results
  // (and corpus BLEU) change only when "Apply reviewer overrides" re-scores.
  const sentences = useMemo(() => applyRefusalOverrides(rawSentences, overrides), [rawSentences, overrides]);
  const pendingOverrides = rawSentences.filter((s) => isRefused(s) && overrides[s.pair_id]).length;
  const counts = countRun(sentences);
  const completedCount = counts.completed;

  const progress = describeProgress(jobStatus, pageState === "submitting");

  const hasBertscore = sentences.some((s) => s.bertscore_f1 != null);
  const idle = pageState !== "running" && pageState !== "submitting";
  const canRunBertOnly = idle && completedCount > 0;
  const canRetry = idle && counts.incomplete > 0;

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
          {pageState === "complete" && (
            <>
              {" "}&middot; {completedCount} completed
              {counts.refused > 0 && <> &middot; <span style={{ color: "var(--danger)" }}>{counts.refused} refused</span></>}
              {counts.excluded > 0 && <> &middot; <span style={{ color: "var(--text-muted)" }}>{counts.excluded} excluded by reviewer</span></>}
              {counts.incomplete > 0 && <> &middot; <span style={{ color: "var(--warning)" }}>{counts.incomplete} incomplete</span></>}
              {counts.formatWarnings > 0 && <> &middot; <span style={{ color: "var(--warning)" }}>{counts.formatWarnings} format warning{counts.formatWarnings !== 1 ? "s" : ""}</span></>}
            </>
          )}
          {pageState === "running" && jobStatus && (
            <>
              {" "}&middot; {jobStatus.translated} translated
              {(jobStatus.refused_rows ?? 0) > 0 && <> &middot; {jobStatus.refused_rows} refused</>}
              {(jobStatus.incomplete_rows ?? 0) > 0 && <> &middot; {jobStatus.incomplete_rows} incomplete</>}
            </>
          )}
        </p>
        {pageState === "complete" && counts.scored > 0 && counts.scored < SMALL_SAMPLE_THRESHOLD && (
          <p style={{ fontSize: 12, color: "var(--warning)", margin: "8px 0 0" }}>
            Small sample: {counts.scored} scored rows. Corpus BLEU and the averages will move a lot with each added sentence; treat this run as a smoke test.
          </p>
        )}
      </div>

      {/* Corpus BLEU hero metric */}
      {jobResults?.corpus_metrics && (
        <div className="anim d1" style={{ marginBottom: 48 }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)", maxWidth: 480 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>SacreBLEU (Overall)</div>
            <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--accent-text)", lineHeight: 1, marginBottom: 16 }}>
              {jobResults.corpus_metrics.overall.bleu_score.toFixed(2)}
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, ...bandStyle(bleuBand(jobResults.corpus_metrics.overall.bleu_score).tone) }}>
              {bleuBand(jobResults.corpus_metrics.overall.bleu_score).label}
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
          <div className="button-row">
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
            {canRetry && (
              <button
                onClick={handleRetryIncomplete}
                title="Re-translate only the rows that failed for provider or configuration reasons, then re-score the whole set."
                style={{
                  fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, borderRadius: "var(--radius-sm)",
                  padding: "10px 24px", cursor: "pointer",
                  background: "var(--warning-light)", color: "var(--warning)",
                  border: "1px solid var(--warning-border)", transition: "all 0.2s",
                }}
              >
                Retry {counts.incomplete} incomplete row{counts.incomplete !== 1 ? "s" : ""}
              </button>
            )}
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

      {/* Progress: one bar that follows the backend's phase */}
      {(pageState === "running" || pageState === "submitting") && (
        <div className="anim d2" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            <span>{progress.label}</span>
            <span>{progress.pct != null ? `${Math.min(100, progress.pct).toFixed(0)}%` : ""}</span>
          </div>
          <div
            className={progress.pct == null ? "progress-indeterminate" : undefined}
            style={{ height: 6, background: "var(--border)", borderRadius: 100, overflow: "hidden" }}
            role="progressbar"
            aria-valuenow={progress.pct != null ? Math.round(progress.pct) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={progress.label}
          >
            {progress.pct != null && (
              <div className="progress-shimmer" style={{ height: "100%", borderRadius: 100, transition: "width 0.4s ease", width: `${Math.min(100, progress.pct)}%` }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            Rows fill in below as each sentence finishes. Keep this tab open: a job with no one watching it is stopped after 5 minutes.
          </div>
        </div>
      )}

      {/* Reviewer overrides not yet reflected in corpus BLEU */}
      {pendingOverrides > 0 && idle && (
        <div style={{ marginBottom: 20, padding: 16, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            {pendingOverrides} refusal{pendingOverrides !== 1 ? "s" : ""} marked legitimate by a reviewer {pendingOverrides !== 1 ? "are" : "is"} shown as excluded, but corpus BLEU still counts {pendingOverrides !== 1 ? "them" : "it"} until you re-score.
          </span>
          <button
            onClick={handleApplyOverrides}
            style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 500, padding: "8px 16px", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
          >
            Apply reviewer overrides &amp; re-score
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ marginBottom: 20, padding: 16, background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-sm)", color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Loading State — session is being restored from browser storage */}
      {restoringSession && rowCount === 0 && pageState === "idle" && (
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 64, textAlign: "center", boxShadow: "var(--shadow)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 18 }}>Loading dataset&hellip;</div>
        </div>
      )}

      {/* Empty State */}
      {!restoringSession && rowCount === 0 && pageState === "idle" && (
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
                  const status = rowStatus(r);
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
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: hasTranslation ? "var(--text-primary)" : "var(--text-muted)" }} title={r.format_warning ? `Format warning: ${r.format_warning}` : r.error ?? undefined}>
                        {r.format_warning && <span style={{ color: "var(--warning)", marginRight: 6 }} aria-label="Format warning">&#9888;</span>}
                        {r.llm_english_translation || (hasError ? r.error : "...")}
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
                        <span title={r.error ?? undefined} style={{
                          display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600,
                          ...bandStyle(status.tone),
                        }}>
                          {status.label}
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
