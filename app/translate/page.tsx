"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelJob, fetchJobResults, pollUntilDone, submitJob } from "@/lib/api";
import { downloadFile, exportResultsCSV, pairsToCSVFile } from "@/lib/csv";
import { DEFAULT_SYSTEM_PROMPT, JobResults, JobStatusResponse } from "@/lib/types";
import {
  getSessionData,
  getSessionGradesAsync,
  getSessionJobId,
  getSessionJobResultsAsync,
  getSessionPrompt,
  setSessionJobId,
  setSessionJobResultsAsync,
} from "@/lib/session";
import {
  AccentBadge,
  BodyText,
  Card,
  DataTable,
  DatasetBadge,
  Heading,
  MetaText,
  MetricValue,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  Section,
  StatusBadge,
  TableHeader,
  TableRow,
} from "@/src/design-system";

type PageState = "idle" | "running" | "complete" | "failed";

export default function TranslatePage() {
  const [pageState, setPageState] = useState<PageState>("idle");
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [results, setResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, 0 | 1 | 2 | 3>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    getSessionJobResultsAsync().then((r) => {
      if (r) {
        setResults(r);
        if (r.status === "complete") setPageState("complete");
      }
    });
    getSessionGradesAsync().then((g) => g && setGrades(g));

    const runningJobId = getSessionJobId();
    if (runningJobId) {
      setPageState("running");
      pollUntilDone(runningJobId, async (s) => {
        setStatus(s);
        const partial = await fetchJobResults(runningJobId).catch(() => null);
        if (partial) setResults(partial);
      }).then(async (final) => {
        setResults(final);
        await setSessionJobResultsAsync(final);
        setPageState(final.status === "complete" ? "complete" : "failed");
      }).catch((e) => {
        setError((e as Error).message);
        setPageState("failed");
      });
    }
  }, []);

  const run = useCallback(async () => {
    const data = getSessionData();
    if (!data?.length) return setError("No dataset loaded. Upload a dataset first.");
    try {
      setError("");
      setPageState("running");
      const job = await submitJob(pairsToCSVFile(data), {
        model: "gpt-4o",
        systemPrompt: getSessionPrompt() || DEFAULT_SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: 1024,
      });
      setSessionJobId(job.job_id);
      const final = await pollUntilDone(job.job_id, async (s) => {
        setStatus(s);
        const partial = await fetchJobResults(job.job_id).catch(() => null);
        if (partial) setResults(partial);
      });
      setResults(final);
      await setSessionJobResultsAsync(final);
      setPageState(final.status === "complete" ? "complete" : "failed");
    } catch (e) {
      setError((e as Error).message);
      setPageState("failed");
    }
  }, []);

  const stop = useCallback(async () => {
    const jobId = getSessionJobId();
    if (jobId) await cancelJob(jobId).catch(() => undefined);
    setPageState("complete");
  }, []);

  const sentences = results?.sentence_metrics ?? [];
  const completedCount = useMemo(() => sentences.filter((s) => s.llm_english_translation && !s.error).length, [sentences]);
  const errorCount = useMemo(() => sentences.filter((s) => s.error).length, [sentences]);
  const total = status?.total ?? sentences.length;
  const bleu = results?.corpus_metrics?.overall.bleu_score;

  return (
    <>
      <Section>
        <Heading>Batch Translation</Heading>
        <BodyText>{total} pairs · {completedCount} completed · {errorCount} errors</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
        <Card>
          <MetaText>SacreBLEU (Overall)</MetaText>
          <MetricValue>{bleu != null ? bleu.toFixed(2) : "--"}</MetricValue>
        </Card>
      </Section>

      <Section style={{ animationDelay: "100ms" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          {pageState === "running" ? (
            <SecondaryButton onClick={stop}>Stop Run</SecondaryButton>
          ) : (
            <PrimaryButton onClick={run}>Run Translations</PrimaryButton>
          )}
          <SecondaryButton disabled={!sentences.length} onClick={() => downloadFile(exportResultsCSV(sentences, grades), "medtranslate_results.csv")}>Export CSV</SecondaryButton>
        </div>
      </Section>

      {(status || pageState === "complete") && (
        <Section style={{ animationDelay: "150ms" }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <MetaText>{status?.translated ?? completedCount} of {total}</MetaText>
              <MetaText>{total ? (((status?.translated ?? completedCount) / total) * 100).toFixed(1) : "0.0"}%</MetaText>
            </div>
            <ProgressBar value={status?.translated ?? completedCount} max={total || 1} />
          </Card>
        </Section>
      )}

      <Section style={{ animationDelay: "200ms" }}>
        <Card>
          <DataTable>
            <TableHeader>
              <TableRow>
                <th>#</th><th>Source</th><th>Spanish (Input)</th><th>LLM English (Output)</th><th>METEOR</th><th>Status</th>
              </TableRow>
            </TableHeader>
            <tbody>
              {sentences.slice(0, 250).map((row, i) => (
                <TableRow key={row.pair_id}>
                  <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                  <td><DatasetBadge dataset={row.source} /></td>
                  <td className="ellipsis">{row.spanish_source}</td>
                  <td className="ellipsis">{row.llm_english_translation || "--"}</td>
                  <td style={{ color: "var(--accent-text)", fontWeight: 500 }}>{row.meteor?.toFixed(3) ?? "--"}</td>
                  <td>{row.error ? <AccentBadge>Error</AccentBadge> : <StatusBadge>Complete</StatusBadge>}</td>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
          {error && <p style={{ color: "var(--danger)", marginTop: 12 }}>{error}</p>}
        </Card>
      </Section>
    </>
  );
}
