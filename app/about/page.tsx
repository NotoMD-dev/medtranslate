"use client";

import Link from "next/link";
import Header from "@/components/Header";
import MetricGuideLink, { METRIC_EXPLAINERS, METRIC_GUIDE_NOTES } from "@/components/MetricGuide";
import { CLINICAL_GRADES, MODEL_OPTIONS, DEFAULT_SYSTEM_PROMPT } from "@/lib/types";

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------

const STEPS = [
  {
    title: "Upload",
    text: "You give MedTranslate a spreadsheet of sentences. Each row has the original clinical text (for example Spanish) and a human-written English translation to compare against. No dataset? Load one of the built-in demo files on the Upload page.",
  },
  {
    title: "Translate",
    text: "The backend sends each sentence, one at a time, to the AI model you picked, with a short instruction telling it to act as a medical interpreter. The model's English answer is saved next to the human translation.",
  },
  {
    title: "Score",
    text: "Three automated scores compare the AI translation with the human one: SacreBLEU (exact wording), METEOR (forgiving wording plus word order), and optionally BERTScore (meaning). These run on the server with standard research libraries so results can be cited.",
  },
  {
    title: "Review",
    text: "Sentences that score poorly on METEOR (below 0.4 by default) are flagged, and any sentence the model refused to translate goes to the top of the queue. A physician reads the original, the human translation, and the AI translation side by side and grades how serious any error is, from 0 (no error) to 3 (could change care).",
  },
  {
    title: "Compare",
    text: "Run the same file through a second model and the Compare page puts the two runs head to head, metric by metric, with the sentences where they differed most.",
  },
];

interface ModelRow {
  id: string;
  label: string;
  provider: string;
  effort: string;
  notes: string;
}

const MODEL_ROWS: ModelRow[] = MODEL_OPTIONS.map((m) =>
  m.provider === "openai"
    ? {
        id: m.id,
        label: m.label,
        provider: "OpenAI",
        effort: "medium (default)",
        notes: "A reasoning model. Effort controls how much the model thinks before answering; set with OPENAI_REASONING_EFFORT (none, low, medium, high, xhigh, max). Temperature is not sent because this model family rejects it.",
      }
    : {
        id: m.id,
        label: m.label,
        provider: "Anthropic",
        effort: "medium (default)",
        notes: "Runs with adaptive thinking on. Effort is set with ANTHROPIC_EFFORT (low, medium, high, xhigh, max). Temperature is not sent because this model family rejects non-default sampling settings.",
      }
);

// ---------------------------------------------------------------------------
// Small layout helpers (kept local to this page)
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 32, boxShadow: "var(--shadow)", ...style }}>
      {children}
    </div>
  );
}

const P: React.CSSProperties = { fontSize: 15, lineHeight: 1.7, color: "var(--text-secondary)", margin: "0 0 12px" };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AboutPage() {
  return (
    <div className="page-container">
      <Header />

      <div className="anim" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.2 }}>
          About MedTranslate
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          What this tool is for, how a run works, which AI models it uses, and how to read the numbers.
        </p>
      </div>

      {/* Purpose */}
      <div className="anim d1" style={{ marginBottom: 48 }}>
        <SectionLabel>Purpose</SectionLabel>
        <Card>
          <p style={P}>
            MedTranslate is a research instrument. It exists to answer one question: <strong style={{ color: "var(--text-primary)" }}>can a large language model translate medical text into English accurately enough to be safe?</strong>
          </p>
          <p style={P}>
            Hospitals see patients who speak many languages, and professional interpreters are not always available. AI translation is fast and cheap, but a single wrong word in a clinical note (a dropped &ldquo;no,&rdquo; a wrong dose, a swapped left and right) can change a diagnosis or a treatment. Before anyone relies on these models, their mistakes need to be counted and classified.
          </p>
          <p style={{ ...P, marginBottom: 0 }}>
            The tool combines two kinds of judgment. Automated scores compare every AI translation against a human translation and give a fast, repeatable number. Physicians then read the sentences the scores flag and decide whether any error actually matters clinically. The automated scores find the suspects; the physicians make the call.
          </p>
        </Card>
      </div>

      {/* How it works */}
      <div className="anim d2" style={{ marginBottom: 48 }}>
        <SectionLabel>How a run works</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {STEPS.map((s, i) => (
            <div key={s.title} style={{ display: "flex", gap: 20, padding: "22px 32px", borderBottom: i < STEPS.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: "var(--accent-soft)", color: "var(--accent-text)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 15,
              }}>
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-secondary)" }}>{s.text}</div>
              </div>
            </div>
          ))}
        </Card>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.6 }}>
          Everything that costs money or needs a secret key (calling the AI models, computing scores) happens on the server. The browser only uploads the file, shows progress, and displays results. API keys never reach the browser.
        </p>
      </div>

      {/* Models */}
      <div className="anim d3" style={{ marginBottom: 48 }}>
        <SectionLabel>Models and effort</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Effort</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_ROWS.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{m.id}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{m.provider}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{m.effort}</td>
                  <td style={{ fontSize: 13, lineHeight: 1.6 }}>{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div style={{ marginTop: 16, display: "grid", gap: 16 }} className="metrics-grid-2">
          <Card style={{ padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>What &ldquo;effort&rdquo; means</div>
            <p style={{ ...P, fontSize: 14, marginBottom: 0 }}>
              Both model families can &ldquo;think&rdquo; before they answer. Effort sets how much. Low effort is faster and cheaper; high effort lets the model reason longer, which can help with tricky sentences but costs more and takes longer. Both models run at <strong style={{ color: "var(--text-primary)" }}>medium</strong> unless the server operator changes the environment variables above. The effort used for a run is saved with its results and shown on the Compare page.
            </p>
          </Card>
          <Card style={{ padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>The instruction each model gets</div>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text-secondary)", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: 14, fontStyle: "italic" }}>
              &ldquo;{DEFAULT_SYSTEM_PROMPT}&rdquo;
            </div>
            <p style={{ ...P, fontSize: 13, color: "var(--text-muted)", margin: "10px 0 0" }}>
              The language name changes with the source language you pick. The same instruction goes to every model so the comparison is fair. Each sentence is sent on its own, with no other context.
            </p>
          </Card>
        </div>
      </div>

      {/* Scores */}
      <div className="anim d4" style={{ marginBottom: 48 }}>
        <SectionLabel>Reading the scores</SectionLabel>
        <Card>
          <p style={P}>{METRIC_GUIDE_NOTES.sharedIdea}</p>
          <div style={{ display: "grid", gap: 14, marginBottom: 16 }}>
            {METRIC_EXPLAINERS.map((m) => (
              <div key={m.key} style={{ padding: 16, background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{m.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>{m.range}</span>
                </div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{m.oneLiner} {m.analogy}</div>
              </div>
            ))}
          </div>
          <p style={{ ...P, fontSize: 14 }}>{METRIC_GUIDE_NOTES.whatTheyMiss}</p>
          <MetricGuideLink label="Open the full plain-language guide" />
        </Card>
      </div>

      {/* Clinical grades */}
      <div className="anim d5" style={{ marginBottom: 48 }}>
        <SectionLabel>Physician grading scale</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Grade</th>
                <th>Category</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              {CLINICAL_GRADES.map((g) => (
                <tr key={g.grade}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: g.bg, color: g.color, fontWeight: 700, fontSize: 14 }}>{g.grade}</span>
                  </td>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{g.label}</td>
                  <td style={{ fontSize: 14, lineHeight: 1.6 }}>{g.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.6 }}>
          Reviewers can also flag the human reference itself when it looks wrong, so a low score caused by a weak reference is not blamed on the AI.
        </p>
      </div>

      {/* Data */}
      <div className="anim d5" style={{ marginBottom: 48 }}>
        <SectionLabel>Data</SectionLabel>
        <Card>
          <p style={P}>
            The main study uses 6,876 sentence pairs from two public corpora: <strong style={{ color: "var(--text-primary)" }}>ClinSpEn</strong> (professionally translated COVID-19 clinical case reports) and <strong style={{ color: "var(--text-primary)" }}>UMass EHR</strong> (de-identified clinical notes). Both are Spanish to English.
          </p>
          <p style={P}>
            You can also upload your own file. It needs a column with the source-language text (for example <code>spanish_source</code> or <code>french_source</code>) and an <code>english_reference</code> column with the human translation. Spanish, French, Korean, Chinese, Portuguese, German, Arabic, Japanese, and Russian are supported.
          </p>
          <p style={{ ...P, marginBottom: 0 }}>
            To try the tool without a dataset, the <Link href="/" style={{ color: "var(--accent-text)", fontWeight: 600 }}>Upload page</Link> offers small synthetic Spanish and French demo files. They contain no real patient data.
          </p>
        </Card>
      </div>

      {/* Caveat */}
      <div className="anim d5" style={{ marginBottom: 48 }}>
        <Card style={{ borderLeft: "4px solid var(--warning)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Not a clinical tool</div>
          <p style={{ ...P, marginBottom: 0, fontSize: 14 }}>
            MedTranslate measures how well AI models translate. It is not itself a translation service for patient care, and a high score here is never proof that a translation is safe to act on.
          </p>
        </Card>
      </div>
    </div>
  );
}
