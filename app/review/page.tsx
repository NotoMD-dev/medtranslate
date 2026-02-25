"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BodyText,
  Card,
  DatasetBadge,
  GhostButton,
  GradeBadge,
  Heading,
  MetaText,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  Section,
  SoftCard,
  WarningBadge,
  DangerBadge,
} from "@/src/design-system";
import { ClinicalGrade, SentenceMetrics } from "@/lib/types";
import { getSessionGradesAsync, getSessionJobResultsAsync, setSessionGradesAsync } from "@/lib/session";

export default function ReviewPage() {
  const [sentences, setSentences] = useState<SentenceMetrics[]>([]);
  const [grades, setGrades] = useState<Record<string, ClinicalGrade>>({});
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getSessionJobResultsAsync().then((r) => r && setSentences(r.sentence_metrics.filter((s) => s.meteor != null && s.meteor < 0.4)));
    getSessionGradesAsync().then((g) => g && setGrades(g));
  }, []);

  const graded = useMemo(() => sentences.filter((s) => grades[s.pair_id] != null).length, [sentences, grades]);
  const current = sentences[idx];

  const setGrade = async (grade: ClinicalGrade) => {
    if (!current) return;
    const next = { ...grades, [current.pair_id]: grade };
    setGrades(next);
    await setSessionGradesAsync(next);
  };

  return (
    <>
      <Section>
        <Heading>Clinical Safety Review</Heading>
        <BodyText>{graded} / {sentences.length} graded</BodyText>
      </Section>

      <Section style={{ animationDelay: "50ms" }}>
        <Card>
          <ProgressBar value={graded} max={sentences.length || 1} />
        </Card>
      </Section>

      <Section style={{ animationDelay: "100ms" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <GhostButton disabled={idx === 0} onClick={() => setIdx((v) => Math.max(0, v - 1))}>Prev</GhostButton>
            <SecondaryButton disabled={idx >= sentences.length - 1} onClick={() => setIdx((v) => Math.min(sentences.length - 1, v + 1))}>Next</SecondaryButton>
            <PrimaryButton onClick={() => {
              const nextUngraded = sentences.findIndex((s, i) => i > idx && grades[s.pair_id] == null);
              if (nextUngraded >= 0) setIdx(nextUngraded);
            }}>Skip to Ungraded</PrimaryButton>
          </div>
          <MetaText>{idx + 1} / {sentences.length}</MetaText>
        </div>
      </Section>

      {current && (
        <Section style={{ animationDelay: "150ms" }}>
          <Card>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
              <BodyText><strong>{current.pair_id}</strong></BodyText>
              <DatasetBadge dataset={current.source} />
              {(current.meteor ?? 0) < 0.2 ? <DangerBadge>METEOR {current.meteor?.toFixed(3)}</DangerBadge> : <WarningBadge>METEOR {current.meteor?.toFixed(3)}</WarningBadge>}
              {grades[current.pair_id] != null && <MetaText>Grade {grades[current.pair_id]}</MetaText>}
            </div>
            <div className="ds-grid three" style={{ marginBottom: 24 }}>
              <SoftCard><MetaText>Spanish Source</MetaText><BodyText>{current.spanish_source}</BodyText></SoftCard>
              <SoftCard><MetaText>LLM English Translation</MetaText><BodyText>{current.llm_english_translation}</BodyText></SoftCard>
              <SoftCard><MetaText>English Reference (Gold Standard)</MetaText><BodyText>{current.english_reference}</BodyText></SoftCard>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div>
                <BodyText><strong>Assign Clinical Significance Grade:</strong></BodyText>
                <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                  {[0, 1, 2, 3].map((g) => (
                    <GradeBadge key={g} selected={grades[current.pair_id] === g} onClick={() => setGrade(g as ClinicalGrade)}>Grade {g}</GradeBadge>
                  ))}
                </div>
              </div>
              <PrimaryButton onClick={() => setIdx((v) => Math.min(sentences.length - 1, v + 1))}>Next Pair</PrimaryButton>
            </div>
          </Card>
        </Section>
      )}

      <Section style={{ animationDelay: "200ms" }}>
        <Card>
          <button className="ds-btn ghost" onClick={() => setOpen((v) => !v)}>All Flagged Pairs (click to jump)</button>
          {open && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              {sentences.map((s, i) => (
                <GhostButton key={s.pair_id} onClick={() => setIdx(i)}>{s.pair_id}</GhostButton>
              ))}
            </div>
          )}
        </Card>
      </Section>
    </>
  );
}
