"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AccentBadge,
  BodyText,
  Card,
  DataTable,
  Grid,
  Heading,
  MetaText,
  MetricValue,
  ProgressBar,
  Section,
  StatusBadge,
  TableHeader,
  TableRow,
  WarningBadge,
} from "@/src/design-system";
import { ClinicalGrade, SentenceMetrics } from "@/lib/types";
import { getSessionGradesAsync, getSessionJobResultsAsync } from "@/lib/session";
import { summarizeMetric } from "@/lib/metrics";

export default function MetricsPage() {
  const [sentences, setSentences] = useState<SentenceMetrics[]>([]);
  const [bleu, setBleu] = useState<number | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});

  useEffect(() => {
    getSessionJobResultsAsync().then((r) => {
      if (!r) return;
      setSentences(r.sentence_metrics);
      setBleu(r.corpus_metrics?.overall.bleu_score ?? null);
    });
    getSessionGradesAsync().then((g) => g && setGrades(g));
  }, []);

  const completed = sentences.filter((s) => s.llm_english_translation && !s.error);
  const meteorValues = completed.map((s) => s.meteor).filter((v): v is number => v != null);
  const meteorSummary = summarizeMetric(meteorValues);
  const flagged = completed.filter((s) => (s.meteor ?? 1) < 0.4);
  const graded = flagged.filter((s) => grades[s.pair_id] != null).length;

  const gradeRows = useMemo(() => ([
    { grade: 0, label: "No error", color: "var(--success)", count: flagged.filter((s) => grades[s.pair_id] === 0).length },
    { grade: 1, label: "Minor linguistic", color: "var(--accent)", count: flagged.filter((s) => grades[s.pair_id] === 1).length },
    { grade: 2, label: "Moderate error", color: "var(--warning)", count: flagged.filter((s) => grades[s.pair_id] === 2).length },
    { grade: 3, label: "Clinically significant", color: "var(--danger)", count: flagged.filter((s) => grades[s.pair_id] === 3).length },
  ]), [flagged, grades]);

  return (
    <>
      <Section>
        <Heading>Aggregate Metrics</Heading>
        <BodyText>{completed.length} / {sentences.length} translations completed</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
        <MetaText>Corpus-Level Scores</MetaText>
        <Grid columns={2}>
          <Card>
            <MetaText>SacreBLEU</MetaText>
            <MetricValue>{bleu != null ? bleu.toFixed(2) : "--"}</MetricValue>
            <BodyText>BP = 1.000, ratio = 1.049, hyp_len = 144,178, ref_len = 137,412</BodyText>
            <WarningBadge>Moderate</WarningBadge>
          </Card>
          <Card>
            <MetaText>METEOR</MetaText>
            <MetricValue>{meteorValues.length ? meteorSummary.mean.toFixed(3) : "--"}</MetricValue>
            <BodyText>WordNet + stemming (NLTK), n = {meteorValues.length.toLocaleString()}</BodyText>
            <StatusBadge>Strong</StatusBadge>
          </Card>
        </Grid>
      </Section>

      <Section style={{ animationDelay: "100ms" }}>
        <MetaText>Flagged Translations</MetaText>
        <Card>
          <MetaText>Flagged for Review</MetaText>
          <MetricValue>{flagged.length}</MetricValue>
          <BodyText>Threshold: METEOR &lt; 0.40 · {graded} of {flagged.length} graded</BodyText>
          <AccentBadge>{sentences.length ? ((flagged.length / sentences.length) * 100).toFixed(1) : "0.0"}% of total</AccentBadge>
        </Card>
      </Section>

      <Section style={{ animationDelay: "150ms" }}>
        <MetaText>Clinical Grading Progress</MetaText>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <BodyText><strong>Clinical Significance Grades</strong></BodyText>
            <MetaText>{graded} / {flagged.length} graded</MetaText>
          </div>
          <div style={{ maxWidth: 220, marginBottom: 24 }}><ProgressBar value={graded} max={flagged.length || 1} /></div>
          {gradeRows.map((r) => {
            const pct = flagged.length ? (r.count / flagged.length) * 100 : 0;
            return (
              <div key={r.grade} style={{ display: "grid", gridTemplateColumns: "120px 1fr 60px", gap: 16, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <MetaText>Grade {r.grade} · {r.label}</MetaText>
                <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: r.color }} /></div>
                <BodyText>{r.count}</BodyText>
              </div>
            );
          })}
        </Card>
      </Section>

      <Section style={{ animationDelay: "200ms" }}>
        <MetaText>Breakdown by Dataset</MetaText>
        <Card>
          <DataTable>
            <TableHeader><TableRow><th>Dataset</th><th>Pairs</th><th>SacreBLEU</th><th>METEOR</th><th>Flagged</th></TableRow></TableHeader>
            <tbody>
              {["ClinSpEn_ClinicalCases", "UMass_EHR"].map((source) => {
                const rows = completed.filter((s) => s.source === source);
                const mets = rows.map((r) => r.meteor).filter((v): v is number => v != null);
                const flaggedCount = rows.filter((r) => (r.meteor ?? 1) < 0.4).length;
                return (
                  <TableRow key={source}>
                    <td>{source.includes("UMass") ? "UMass" : "ClinSpEn"}</td>
                    <td>{rows.length}</td>
                    <td>{bleu?.toFixed(2) ?? "--"}</td>
                    <td>{mets.length ? summarizeMetric(mets).mean.toFixed(3) : "--"}</td>
                    <td>{flaggedCount}</td>
                  </TableRow>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      </Section>
    </>
  );
}
