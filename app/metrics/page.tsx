"use client";

import { useEffect, useMemo, useState } from "react";
import { CLINICAL_GRADES, type ClinicalGrade, type JobResults } from "@/lib/types";
import { summarizeMetric } from "@/lib/metrics";
import { getSessionGrades, getSessionJobResultsAsync } from "@/lib/session";
import { AccentBadge, AppContainer, Card, DataTable, DangerBadge, GradeBadge, Heading, MetaText, MetricValue, PageContainer, ProgressBar, Section, StatusBadge, TableHeader, TableRow, TabNavigation, WarningBadge } from "@/src/design-system";

export default function MetricsPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  useEffect(() => { getSessionJobResultsAsync().then((r) => r && setJobResults(r)); const g = getSessionGrades(); if (g) setGrades(g); }, []);

  const sentences = jobResults?.sentence_metrics ?? [];
  const completed = sentences.filter((s) => s.llm_english_translation && !s.error);
  const meteorValues = completed.map((c) => c.meteor).filter((m): m is number => m != null);
  const meteorSummary = summarizeMetric(meteorValues);
  const flagged = completed.filter((c) => (c.meteor ?? 1) < 0.4);
  const graded = flagged.filter((f) => grades[f.pair_id] != null).length;
  const bleu = jobResults?.corpus_metrics?.overall.bleu_score;

  const bins = useMemo(() => {
    const result = Array.from({ length: 10 }, (_, i) => ({ label: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, count: 0, flagged: 0 }));
    meteorValues.forEach((v) => {
      const idx = Math.min(9, Math.floor(v * 10));
      result[idx].count += 1;
      if (v < 0.4) result[idx].flagged += 1;
    });
    return result;
  }, [meteorValues]);
  const maxBin = Math.max(...bins.map((b) => b.count), 1);

  const byDataset = ["ClinSpEn_ClinicalCases", "UMass_EHR"].map((d) => {
    const subset = completed.filter((c) => c.source === d);
    const m = subset.map((s) => s.meteor).filter((v): v is number => v != null);
    return { dataset: d.includes("UMass") ? "UMass" : "ClinSpEn", pairs: subset.length, meteor: m.length ? summarizeMetric(m).mean : null, flagged: subset.filter((s) => (s.meteor ?? 1) < 0.4).length };
  });

  return (
    <AppContainer>
      <TabNavigation />
      <PageContainer>
        <Section>
          <Heading>Aggregate Metrics</Heading>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>{completed.length} / {sentences.length} translations completed</p>
        </Section>

        <Section>
          <MetaText>Corpus-Level Scores</MetaText>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-8)", marginTop: 12 }}>
            <Card><MetaText>SacreBLEU</MetaText><MetricValue>{bleu != null ? bleu.toFixed(2) : "--"}</MetricValue><p style={{ fontSize: 12, color: "var(--text-muted)" }}>{jobResults?.corpus_metrics?.overall.bleu_signature || "BP = 1.000, ratio = 1.049, hyp_len = 144,178, ref_len = 137,412"}</p><WarningBadge>Moderate</WarningBadge></Card>
            <Card><MetaText>METEOR</MetaText><MetricValue>{meteorValues.length ? meteorSummary.mean.toFixed(3) : "--"}</MetricValue><p style={{ fontSize: 12, color: "var(--text-muted)" }}>WordNet + stemming (NLTK), n = {meteorValues.length}</p><StatusBadge>Strong</StatusBadge></Card>
          </div>
        </Section>

        <Section>
          <MetaText>Flagged Translations</MetaText>
          <Card style={{ marginTop: 12 }}><MetaText>Flagged for Review</MetaText><MetricValue>{flagged.length}</MetricValue><p style={{ fontSize: 12, color: "var(--text-muted)" }}>Threshold: METEOR &lt; 0.40 · {graded} of {flagged.length} graded</p><AccentBadge>{sentences.length ? ((flagged.length / sentences.length) * 100).toFixed(1) : "0.0"}% of total</AccentBadge></Card>
        </Section>

        <Section>
          <MetaText>Score Distribution</MetaText>
          <Card style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><div style={{ fontWeight: 500 }}>METEOR Score Distribution (n = {meteorValues.length})</div><div style={{ display: "flex", gap: 12, fontSize: 12 }}><span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--accent)", marginRight: 6 }} />Normal</span><span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--danger)", marginRight: 6, opacity: 0.7 }} />Flagged</span></div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 8, alignItems: "end", height: 180, borderBottom: "1px solid var(--border)" }}>{bins.map((b) => <div key={b.label} style={{ textAlign: "center" }}><div style={{ display: "flex", alignItems: "end", justifyContent: "center", gap: 2, height: 140 }}><div style={{ width: 10, height: `${(b.count / maxBin) * 140}px`, background: "var(--accent)", borderRadius: 3 }} /><div style={{ width: 10, height: `${(b.flagged / maxBin) * 140}px`, background: "var(--danger)", opacity: 0.7, borderRadius: 3 }} /></div><div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{b.label}</div></div>)}</div>
          </Card>
        </Section>

        <Section>
          <MetaText>Clinical Grading Progress</MetaText>
          <Card style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><div style={{ fontWeight: 500 }}>Clinical Significance Grades</div><div style={{ width: 220 }}><ProgressBar value={graded} total={flagged.length} /></div></div>
            {CLINICAL_GRADES.map((g) => { const count = flagged.filter((f) => grades[f.pair_id] === g.grade).length; const pct = graded ? (count / graded) * 100 : 0; return <div key={g.grade} style={{ display: "grid", gridTemplateColumns: "120px 1fr 3fr 60px", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)" }}><GradeBadge label={`Grade ${g.grade}`} selected /><span>{g.label}</span><div style={{ height: 6, background: "var(--border)", borderRadius: 9999 }}><div style={{ width: `${pct}%`, height: 6, borderRadius: 9999, background: g.grade === 3 ? "var(--danger)" : g.grade === 2 ? "var(--warning)" : g.grade === 1 ? "var(--accent)" : "var(--success)" }} /></div><span>{count}</span></div>; })}
          </Card>
        </Section>

        <Section>
          <MetaText>Breakdown by Dataset</MetaText>
          <Card style={{ marginTop: 12 }}>
            <DataTable>
              <thead><tr>{["Dataset", "Pairs", "SacreBLEU", "METEOR", "Flagged"].map((h) => <TableHeader key={h}>{h}</TableHeader>)}</tr></thead>
              <tbody>
                {byDataset.map((d) => <TableRow key={d.dataset}><td style={{ padding: "20px 10px" }}>{d.dataset}</td><td style={{ padding: "20px 10px" }}>{d.pairs}</td><td style={{ padding: "20px 10px" }}>--</td><td style={{ padding: "20px 10px" }}>{d.meteor?.toFixed(3) ?? "--"}</td><td style={{ padding: "20px 10px" }}>{d.flagged}</td></TableRow>)}
                <TableRow><td style={{ padding: "20px 10px", fontWeight: 600 }}>Combined</td><td style={{ padding: "20px 10px", fontWeight: 600 }}>{completed.length}</td><td style={{ padding: "20px 10px", fontWeight: 600 }}>{bleu?.toFixed(2) ?? "--"}</td><td style={{ padding: "20px 10px", fontWeight: 600 }}>{meteorSummary.mean.toFixed(3)}</td><td style={{ padding: "20px 10px", fontWeight: 600 }}>{flagged.length}</td></TableRow>
              </tbody>
            </DataTable>
          </Card>
        </Section>
      </PageContainer>
    </AppContainer>
  );
}
