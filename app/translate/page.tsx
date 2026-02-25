"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, fetchJobResults, pollUntilDone, submitJob } from "@/lib/api";
import { downloadFile, exportResultsCSV, pairsToCSVFile } from "@/lib/csv";
import { DEFAULT_SYSTEM_PROMPT, type ClinicalGrade, type JobResults, type JobStatusResponse } from "@/lib/types";
import { getSessionData, getSessionJobId, getSessionJobResultsAsync, getSessionPrompt, getSessionGradesAsync, setSessionGradesAsync, setSessionJobId, setSessionJobResultsAsync } from "@/lib/session";
import { AccentBadge, AppContainer, Card, DataTable, DatasetBadge, Heading, MetaText, MetricValue, PageContainer, PrimaryButton, ProgressBar, SecondaryButton, Section, StatusBadge, TableHeader, TableRow, TabNavigation, WarningBadge, DangerBadge } from "@/src/design-system";

export default function TranslatePage() {
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const abortRef = useRef(false);

  useEffect(() => {
    getSessionJobResultsAsync().then((r) => { if (r) { setJobResults(r); setRowCount(r.sentence_metrics.length); } });
    getSessionGradesAsync().then((g) => g && setGrades(g));
    const data = getSessionData();
    if (data) setRowCount(data.length);
    const jobId = getSessionJobId();
    if (jobId) resumePolling(jobId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumePolling = useCallback(async (jobId: string) => {
    setRunning(true);
    try {
      const results = await pollUntilDone(jobId, async (status) => {
        if (abortRef.current) return;
        setJobStatus(status);
        const partial = await fetchJobResults(jobId).catch(() => null);
        if (partial) setJobResults(partial);
      }, 2000);
      setJobResults(results);
      await setSessionJobResultsAsync(results);
    } catch (e) {
      setError((e as Error).message);
    } finally { setRunning(false); }
  }, []);

  const handleRun = useCallback(async () => {
    const data = getSessionData();
    if (!data?.length) return setError("No dataset loaded.");
    setError(null); setRunning(true); abortRef.current = false;
    try {
      const { job_id } = await submitJob(pairsToCSVFile(data), { model: "gpt-4o", systemPrompt: getSessionPrompt() || DEFAULT_SYSTEM_PROMPT, temperature: 0, maxTokens: 1024, computeBertscore: false });
      setSessionJobId(job_id);
      await resumePolling(job_id);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }, [resumePolling]);

  const handleAbort = useCallback(async () => {
    abortRef.current = true;
    const jobId = getSessionJobId();
    if (jobId) await cancelJob(jobId).catch(() => null);
    setRunning(false);
  }, []);

  const sentences = jobResults?.sentence_metrics ?? [];
  const completed = sentences.filter((s) => s.llm_english_translation && !s.error).length;
  const errors = sentences.filter((s) => s.error).length;
  const bleu = jobResults?.corpus_metrics?.overall.bleu_score;

  return (
    <AppContainer>
      <TabNavigation />
      <PageContainer>
        <Section>
          <Heading>Batch Translation</Heading>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8 }}>{rowCount} pairs · {completed} completed · {errors} errors</p>
        </Section>

        <Section>
          <Card>
            <MetaText>SacreBLEU (Overall)</MetaText>
            <MetricValue>{bleu != null ? bleu.toFixed(2) : "--"}</MetricValue>
          </Card>
        </Section>

        <Section style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <PrimaryButton onClick={handleRun} disabled={running}>{running ? "Running..." : "Run Translations"}</PrimaryButton>
            {running && <SecondaryButton onClick={handleAbort}>Abort</SecondaryButton>}
            <SecondaryButton onClick={() => jobResults && downloadFile(exportResultsCSV(jobResults.sentence_metrics, grades), "medtranslate_results.csv")} disabled={!jobResults}>Export CSV</SecondaryButton>
          </div>
        </Section>

        {(running || jobStatus) && <Section style={{ marginBottom: 24 }}><ProgressBar value={jobStatus?.translated ?? 0} total={jobStatus?.total ?? rowCount} /></Section>}
        {error && <Section style={{ marginBottom: 24 }}><Card><p style={{ color: "var(--danger)", margin: 0 }}>{error}</p></Card></Section>}

        <Section>
          <Card>
            <DataTable>
              <thead><tr>{["#", "Source", "Spanish", "LLM English", "METEOR", "Status"].map((h) => <TableHeader key={h}>{h}</TableHeader>)}</tr></thead>
              <tbody>
                {sentences.slice(0, 200).map((r, i) => (
                  <TableRow key={`${r.pair_id}-${i}`}>
                    <td style={{ padding: "20px 10px", color: "var(--text-muted)", fontSize: 14 }}>{i + 1}</td>
                    <td style={{ padding: "20px 10px" }}><DatasetBadge source={r.source} /></td>
                    <td style={{ padding: "20px 10px", fontSize: 14, color: "var(--text-secondary)", maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.spanish_source}</td>
                    <td style={{ padding: "20px 10px", fontSize: 14, color: "var(--text-secondary)", maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.llm_english_translation || "..."}</td>
                    <td style={{ padding: "20px 10px", color: "var(--accent-text)", fontWeight: 500 }}>{r.meteor != null ? r.meteor.toFixed(3) : "--"}</td>
                    <td style={{ padding: "20px 10px" }}>{r.error ? <DangerBadge>Error</DangerBadge> : r.llm_english_translation ? <StatusBadge>Complete</StatusBadge> : <WarningBadge>Pending</WarningBadge>}</td>
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
            {sentences.length > 200 && <div style={{ marginTop: 12 }}><AccentBadge>Showing first 200 rows</AccentBadge></div>}
          </Card>
        </Section>
      </PageContainer>
    </AppContainer>
  );
}
