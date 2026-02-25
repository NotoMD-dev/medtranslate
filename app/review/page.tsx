"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CLINICAL_GRADES, type ClinicalGrade, type JobResults } from "@/lib/types";
import { getSessionGradesAsync, getSessionJobResultsAsync, setSessionGradesAsync } from "@/lib/session";
import { AppContainer, Card, DatasetBadge, GhostButton, GradeBadge, Heading, MetaText, PageContainer, PrimaryButton, ProgressBar, SecondaryButton, Section, SoftCard, TabNavigation, WarningBadge, DangerBadge } from "@/src/design-system";

export default function ReviewPage() {
  const [jobResults, setJobResults] = useState<JobResults | null>(null);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [current, setCurrent] = useState(0);
  const [jumpInput, setJumpInput] = useState("");

  useEffect(() => {
    getSessionJobResultsAsync().then((r) => r && setJobResults(r));
    getSessionGradesAsync().then((g) => g && setGrades(g));
  }, []);

  const flagged = useMemo(() => (jobResults?.sentence_metrics ?? []).filter((s) => s.llm_english_translation && !s.error && (s.meteor ?? 1) < 0.4), [jobResults]);
  const graded = flagged.filter((r) => grades[r.pair_id] != null).length;
  const pair = flagged[current];

  const setGrade = useCallback((grade: ClinicalGrade) => {
    if (!pair) return;
    setGrades((prev) => {
      const next = { ...prev, [pair.pair_id]: grade };
      setSessionGradesAsync(next);
      return next;
    });
  }, [pair]);

  const skipUngraded = () => {
    const next = flagged.findIndex((f, i) => i > current && grades[f.pair_id] == null);
    if (next >= 0) setCurrent(next);
  };

  return (
    <AppContainer>
      <TabNavigation />
      <PageContainer>
        <Section>
          <Heading>Clinical Safety Review</Heading>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8 }}>{graded} / {flagged.length} graded</p>
          <div style={{ marginTop: 12 }}><ProgressBar value={graded} total={flagged.length} /></div>
        </Section>

        {flagged.length === 0 ? <Section><Card>No flagged pairs yet. Run translations first.</Card></Section> : (
          <>
            <Section style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <GhostButton onClick={() => setCurrent(Math.max(0, current - 1))}>Prev</GhostButton>
                  <SecondaryButton onClick={() => setCurrent(Math.min(flagged.length - 1, current + 1))}>Next</SecondaryButton>
                  <PrimaryButton onClick={skipUngraded}>Skip to Ungraded</PrimaryButton>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <MetaText>{current + 1} / {flagged.length}</MetaText>
                  <input value={jumpInput} onChange={(e) => setJumpInput(e.target.value)} placeholder="Jump to" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", background: "transparent", color: "var(--text-primary)" }} />
                  <SecondaryButton onClick={() => { const idx = Number(jumpInput) - 1; if (idx >= 0 && idx < flagged.length) setCurrent(idx); }}>Go</SecondaryButton>
                </div>
              </div>
            </Section>

            {pair && <Section>
              <Card>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{pair.pair_id}</div>
                  <DatasetBadge source={pair.source} />
                  {(pair.meteor ?? 0) < 0.2 ? <DangerBadge>METEOR {pair.meteor?.toFixed(3)}</DangerBadge> : <WarningBadge>METEOR {pair.meteor?.toFixed(3)}</WarningBadge>}
                  {grades[pair.pair_id] != null && <GradeBadge label={`Grade ${grades[pair.pair_id]}`} selected />}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-8)" }}>
                  <SoftCard><MetaText>Spanish Source</MetaText><p style={{ fontSize: 14, lineHeight: 1.625 }}>{pair.spanish_source}</p></SoftCard>
                  <SoftCard><MetaText>LLM English Translation</MetaText><p style={{ fontSize: 14, lineHeight: 1.625 }}>{pair.llm_english_translation}</p></SoftCard>
                  <SoftCard><MetaText>English Reference (Gold Standard)</MetaText><p style={{ fontSize: 14, lineHeight: 1.625 }}>{pair.english_reference}</p></SoftCard>
                </div>
                <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Assign Clinical Significance Grade:</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {CLINICAL_GRADES.map((g) => <GradeBadge key={g.grade} label={`Grade ${g.grade}: ${g.label}`} selected={grades[pair.pair_id] === g.grade} onClick={() => setGrade(g.grade)} />)}
                    </div>
                  </div>
                  <PrimaryButton onClick={() => setCurrent(Math.min(flagged.length - 1, current + 1))}>Next Pair</PrimaryButton>
                </div>
              </Card>
            </Section>}

            <Section>
              <Card>
                <div style={{ marginBottom: 16, fontWeight: 600 }}>All Flagged Pairs (click to jump)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {flagged.map((f, i) => <GhostButton key={f.pair_id} onClick={() => setCurrent(i)}>{f.pair_id}</GhostButton>)}
                </div>
              </Card>
            </Section>
          </>
        )}
      </PageContainer>
    </AppContainer>
  );
}
