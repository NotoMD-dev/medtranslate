"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// Plain-language explanations of the three automated scores.
// Written so that someone with no background in machine translation can
// follow along. Reused by the "What do these scores mean?" modal and the
// About page.
// ---------------------------------------------------------------------------

export interface MetricExplainer {
  key: "bleu" | "meteor" | "bertscore";
  name: string;
  range: string;
  rangeNote?: string;
  /** "Simple explanation". Also the one-liner on the About page. */
  simple: string[];
  example: { reference: string; translation: string; note: string };
  howItWorks: string[];
  /** "Think of it this way". */
  analogy: string;
  /** Plain-language score bands, lowest first. */
  bands: { range: string; meaning: string }[];
  bandsNote: string;
  /** An extra question-and-answer block (the ± spread, why BERTScore is missing). */
  extra?: { title: string; text: string[] };
  goodToKnow: string[];
  goodToKnowList?: string[];
  technical: { formulas: string[]; terms: string[]; note?: string };
}

export const METRIC_EXPLAINERS: MetricExplainer[] = [
  {
    key: "bleu",
    name: "SacreBLEU",
    range: "0 to 100",
    simple: [
      "SacreBLEU looks for exact words and phrases that appear in both the AI translation and the reference English text.",
      "More exact matches generally produce a higher score.",
    ],
    example: {
      reference: "The patient has no fever.",
      translation: "The patient does not have a fever.",
      note: "These sentences communicate nearly the same information, but they do not use exactly the same words. SacreBLEU may therefore give the translation a lower score than a person might expect.",
    },
    howItWorks: [
      "SacreBLEU divides both versions into groups of one, two, three, and four consecutive words. It then checks how many groups from the AI translation also appear in the reference.",
      "It also lowers the score when the AI translation is much shorter than the reference.",
      "SacreBLEU calculates one score for the entire file rather than a separate score for every sentence.",
    ],
    analogy:
      "Imagine placing two documents side by side and highlighting every phrase that appears exactly the same in both. More highlighting generally means a higher SacreBLEU score.",
    bands: [
      { range: "Under 20", meaning: "Little exact overlap. The translation may have a problem, or it may simply use very different wording." },
      { range: "20 to 40", meaning: "Moderate overlap. Much of the wording matches, but there are noticeable differences." },
      { range: "Over 40", meaning: "Strong overlap with the reference wording." },
    ],
    bandsNote:
      "These ranges are only rough guides. A score of 100 means the wording matched almost exactly. It does not prove that the translation is medically correct.",
    goodToKnow: [
      "SacreBLEU is strict about wording. For example, \"doctor\" and \"physician\" may not count as a match even though they usually mean the same thing.",
      "Extra words can lower the score, as can a translation that is much shorter than the reference. Scores may also change substantially when the file contains only a small number of sentences.",
    ],
    technical: {
      formulas: ["BLEU = 100 × BP × (p₁ × p₂ × p₃ × p₄)^(1/4)"],
      terms: [
        "p₁ through p₄ are the proportions of matching one-, two-, three-, and four-word groups.",
        "BP is the brevity penalty. It equals 1 when the AI translation is at least as long as the reference and falls below 1 when the AI translation is shorter.",
      ],
    },
  },
  {
    key: "meteor",
    name: "METEOR",
    range: "0 to 1",
    simple: [
      "METEOR is more flexible than SacreBLEU. It can recognize some related words and word forms, and it also considers word order.",
    ],
    example: {
      reference: "The physician treated the patient.",
      translation: "The doctor provided treatment to the patient.",
      note: "SacreBLEU may lower the score because several words are different. METEOR may recognize that \"physician\" and \"doctor,\" as well as \"treated\" and \"treatment,\" are related.",
    },
    howItWorks: [
      "METEOR lines up words in the AI translation with words in the reference. A match may be recognized when the words are identical, when they share a root, such as \"treat\" and \"treated,\" or when they are recognized as synonyms, such as \"doctor\" and \"physician.\"",
      "METEOR also checks whether the matching words appear in a similar order. Scrambled word order lowers the score.",
      "The app calculates a score for each sentence and then displays the average.",
    ],
    analogy:
      "Imagine a teacher grading a summary. The teacher accepts \"large\" in place of \"big\" and cares more about whether the important information is included than whether every word is identical.",
    bands: [
      { range: "Under 0.40", meaning: "Flagged for physician review. Information may be missing or expressed very differently." },
      { range: "0.40 to 0.60", meaning: "Fair similarity, with noticeable differences." },
      { range: "0.60 to 0.75", meaning: "Good similarity. Most of the reference content is represented." },
      { range: "Over 0.75", meaning: "Strong similarity in content and wording." },
    ],
    bandsNote:
      "These ranges help organize the results, but they do not determine whether a translation is medically safe.",
    extra: {
      title: "What does the ± number mean?",
      text: [
        "The ± value shows how much the sentence scores vary.",
        "A small value means most sentences received similar scores. A large value means some sentences scored much better than others. A good average can therefore hide one or more poorly translated sentences.",
      ],
    },
    goodToKnow: [
      "METEOR usually cares more about missing information than additional wording. A translation that adds an explanation may therefore lose less on METEOR than it does on SacreBLEU.",
    ],
    technical: {
      formulas: [
        "METEOR = F × [1 − 0.5 × (chunks ÷ matched words)³]",
        "F = 10PR ÷ (R + 9P)",
      ],
      terms: [
        "P, or precision: The proportion of words in the AI translation that matched the reference.",
        "R, or recall: The proportion of words in the reference that were represented in the AI translation.",
        "Chunks: Groups of matching words that appear in the same order.",
      ],
      note: "The formula places more weight on including the content of the reference than on avoiding additional words.",
    },
  },
  {
    key: "bertscore",
    name: "BERTScore F1",
    range: "0 to 1 after rescaling",
    rangeNote: "Typical displayed range. A rescaled score can occasionally fall slightly below 0.",
    simple: [
      "BERTScore looks for similarities in context and meaning rather than requiring the same words.",
    ],
    example: {
      reference: "The patient has no fever.",
      translation: "Fever is absent.",
      note: "Very few words match exactly, but the sentences communicate a similar idea. BERTScore may therefore rate them as highly similar.",
    },
    howItWorks: [
      "BERTScore uses an English-language AI model to represent each word, or part of a word, based on its context. It then estimates how closely the AI translation and the reference English text align.",
      "MedTranslate currently uses the roberta-base language model for this comparison.",
    ],
    analogy:
      "Instead of asking, \"Did these sentences use the same words?\" BERTScore asks, \"Do these sentences appear to communicate the same idea?\"",
    bands: [
      { range: "Under 0.50", meaning: "Substantial differences may be present. Review closely." },
      { range: "0.50 to 0.80", meaning: "The sentences appear similar but contain noticeable differences." },
      { range: "Over 0.80", meaning: "Strong contextual similarity." },
    ],
    bandsNote:
      "These ranges are rough guides. A high BERTScore does not prove that every clinical detail is correct.",
    extra: {
      title: "Why is BERTScore sometimes missing?",
      text: [
        "BERTScore requires a larger language model and is turned off by default. Select Include BERTScore on the Translate page before starting a job.",
        "If BERTScore was not calculated, the app displays \"--\" and does not include it in the head-to-head tally.",
      ],
    },
    goodToKnow: [
      "BERTScore can miss small but dangerous differences. For example:",
    ],
    goodToKnowList: [
      "\"The patient has a fever\" versus \"The patient has no fever.\"",
      "\"Give 5 mg\" versus \"Give 50 mg.\"",
      "\"Left-sided weakness\" versus \"right-sided weakness.\"",
      "\"Take once daily\" versus \"take twice daily.\"",
    ],
    technical: {
      formulas: [
        "F1 = 2PR ÷ (P + R)",
        "Rescaled F1 = (F1 − b) ÷ (1 − b)",
      ],
      terms: [
        "P, or precision: How closely the AI translation aligns with the reference.",
        "R, or recall: How closely the reference is represented by the AI translation.",
        "b: A baseline measured using unrelated sentence pairs.",
      ],
      note: "After rescaling, a score near 0 means the sentences are no more similar than the baseline comparison. A score near 1 indicates very strong similarity.",
    },
  },
];

export const METRIC_GUIDE_NOTES = {
  intro: {
    scope:
      "MedTranslate evaluates clinical translations from supported source languages into English. Translation from English into other languages is not currently supported.",
    uses:
      "The app uses three scores, SacreBLEU, METEOR, and BERTScore, to compare the AI-generated English translation with a reference English version of the same text.",
    referenceMayBe: [
      "The original English text from a bilingual dataset, or",
      "An English translation written or reviewed by a person.",
    ],
    eachLooks: [
      "SacreBLEU: Does the AI use the same English words and phrases as the reference?",
      "METEOR: Does it use the same or similar words, word forms, and word order?",
      "BERTScore: Do the two English versions appear to communicate similar meaning?",
    ],
    caution:
      "A higher score means a closer match according to that metric. However, no score can prove that a translation is medically correct or safe. Important differences involving negation, medication doses, dates, numbers, or laterality may be missed. That is why physician review remains necessary.",
    rangesNote:
      "The score ranges below are rough guides used by this application. They are not universal grades, and results may vary depending on the dataset and its size.",
  },
  whyDisagree: {
    lead: "Each score asks a different question:",
    bullets: [
      "SacreBLEU: Are the exact words and phrases similar?",
      "METEOR: Are the words, word forms, synonyms, and word order similar?",
      "BERTScore: Does the language appear to communicate similar meaning?",
    ],
    after: [
      "The same translation can therefore receive a low SacreBLEU score but higher METEOR and BERTScore results. This often happens when the AI rephrases a sentence, expands an abbreviation, or adds explanatory wording.",
      "Low results across all three metrics may indicate a translation problem. They may also occur when the reference English text is unusually brief, loosely written, or incomplete.",
      "No single score should be interpreted by itself.",
    ],
  },
  whatTheyMiss: {
    lead: "All three scores measure overall similarity. They may not give enough weight to one small but medically important difference. Examples include:",
    examples: [
      "Adding or removing the word \"no.\"",
      "Changing 5 mg to 50 mg.",
      "Changing \"left\" to \"right.\"",
      "Changing \"allergic\" to \"not allergic.\"",
      "Changing a medication frequency or date.",
      "Leaving out an important diagnosis, symptom, or instruction.",
    ],
    forThisReason: [
      "Translations below the app's METEOR threshold are flagged for physician review.",
      "Individual sentence results should be reviewed, not only the overall average.",
      "A high score should never be treated as proof that a translation is medically correct or safe.",
    ],
  },
  headToHead: [
    "On the Compare page, the model with the higher score wins that metric.",
    "A difference smaller than 0.001 is treated as a tie. If a metric was not calculated for either model, that metric is left out of the tally.",
    "The head-to-head result shows which AI translation matched the reference English text more closely according to these automated measures. It does not determine which translation is clinically safest.",
  ],
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

const H3: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text-primary)", margin: "14px 0 4px" };
const PARA: React.CSSProperties = { margin: "0 0 8px", color: "var(--text-secondary)" };
const LIST: React.CSSProperties = { margin: "0 0 8px", paddingLeft: 20, color: "var(--text-secondary)" };
const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 13, color: "var(--text-primary)", overflowWrap: "anywhere",
};

function Bullets({ items, style }: { items: string[]; style?: React.CSSProperties }) {
  return (
    <ul style={{ ...LIST, ...style }}>
      {items.map((t) => <li key={t} style={{ marginBottom: 3 }}>{t}</li>)}
    </ul>
  );
}

function ExampleBox({ example }: { example: MetricExplainer["example"] }) {
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2 };
  const text: React.CSSProperties = { fontSize: 14, color: "var(--text-primary)", fontStyle: "italic" };
  return (
    <div style={{ margin: "0 0 8px", padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)" }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 8 }}>
        <div>
          <div style={label}>Reference</div>
          <div style={text}>{example.reference}</div>
        </div>
        <div>
          <div style={label}>AI translation</div>
          <div style={text}>{example.translation}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>{example.note}</div>
    </div>
  );
}

function MetricSection({ m }: { m: MetricExplainer }) {
  return (
    <section style={{ marginBottom: 24, padding: 18, background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</span>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>Score range: {m.range}</span>
      </div>
      {m.rangeNote && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{m.rangeNote}</div>}

      <div style={{ ...H3, marginTop: 8 }}>Simple explanation</div>
      {m.simple.map((t) => <p key={t} style={PARA}>{t}</p>)}

      <div style={H3}>Example</div>
      <ExampleBox example={m.example} />

      <div style={H3}>How does it work?</div>
      {m.howItWorks.map((t) => <p key={t} style={PARA}>{t}</p>)}

      <div style={H3}>Think of it this way</div>
      <p style={PARA}>{m.analogy}</p>

      <div style={H3}>How should I interpret the score?</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8, fontSize: 13 }}>
        <tbody>
          {m.bands.map((b) => (
            <tr key={b.range}>
              <td style={{ padding: "5px 8px 5px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top", width: 110, borderBottom: "1px solid var(--border-subtle)" }}>{b.range}</td>
              <td style={{ padding: "5px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}>{b.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...PARA, fontSize: 13 }}>{m.bandsNote}</p>

      {m.extra && (
        <>
          <div style={H3}>{m.extra.title}</div>
          {m.extra.text.map((t) => <p key={t} style={PARA}>{t}</p>)}
        </>
      )}

      <div style={H3}>Good to know</div>
      {m.goodToKnow.map((t) => <p key={t} style={PARA}>{t}</p>)}
      {m.goodToKnowList && (
        <>
          <Bullets items={m.goodToKnowList} />
          <p style={PARA}>These sentence pairs are very similar overall, but their differences could be clinically important.</p>
        </>
      )}

      <div style={H3}>Technical details</div>
      <div style={{ padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)" }}>
        {m.technical.formulas.map((f) => <div key={f} style={{ ...MONO, marginBottom: 4 }}>{f}</div>)}
        <Bullets items={m.technical.terms} style={{ fontSize: 12, margin: "6px 0 0" }} />
        {m.technical.note && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>{m.technical.note}</div>}
      </div>
    </section>
  );
}

function MetricGuideModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const n = METRIC_GUIDE_NOTES;
  const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, marginBottom: 6 };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.3)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-guide-title"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 1000, background: "var(--bg-surface)",
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          width: 720, maxWidth: "92vw", maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          color: "var(--text-primary)",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "20px 28px 14px", borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div id="metric-guide-title" style={{ fontSize: 17, fontWeight: 700 }}>What do these scores mean?</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>A complete explanation of SacreBLEU, METEOR, and BERTScore</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 22, color: "var(--text-muted)", padding: "0 4px", lineHeight: 1 }}
          >&times;</button>
        </div>

        <div style={{ overflowY: "auto", padding: "20px 28px 28px", fontSize: 14, lineHeight: 1.65 }}>
          <p style={PARA}>{n.intro.scope}</p>
          <p style={PARA}>{n.intro.uses}</p>
          <p style={{ ...PARA, marginBottom: 2 }}>The reference English text may be:</p>
          <Bullets items={n.intro.referenceMayBe} />
          <p style={{ ...PARA, marginBottom: 2 }}>Each score looks at the translation differently:</p>
          <Bullets items={n.intro.eachLooks} />
          <p style={PARA}>{n.intro.caution}</p>
          <p style={{ ...PARA, marginBottom: 20 }}>{n.intro.rangesNote}</p>

          {METRIC_EXPLAINERS.map((m) => <MetricSection key={m.key} m={m} />)}

          <section style={{ marginBottom: 20 }}>
            <div style={sectionTitle}>Why might the scores disagree?</div>
            <p style={{ ...PARA, marginBottom: 2 }}>{n.whyDisagree.lead}</p>
            <Bullets items={n.whyDisagree.bullets} />
            {n.whyDisagree.after.map((t) => <p key={t} style={PARA}>{t}</p>)}
          </section>

          <section style={{ marginBottom: 20 }}>
            <div style={sectionTitle}>What can these scores miss?</div>
            <p style={{ ...PARA, marginBottom: 2 }}>{n.whatTheyMiss.lead}</p>
            <Bullets items={n.whatTheyMiss.examples} />
            <p style={{ ...PARA, marginBottom: 2 }}>For this reason:</p>
            <Bullets items={n.whatTheyMiss.forThisReason} />
          </section>

          <section>
            <div style={sectionTitle}>How is the head-to-head winner selected?</div>
            {n.headToHead.map((t) => <p key={t} style={PARA}>{t}</p>)}
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline link that opens the guide
// ---------------------------------------------------------------------------

export default function MetricGuideLink({
  label = "What do these scores mean?",
  style,
}: {
  label?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  // Page sections animate in with a transform (see .anim in theme.css), which
  // makes any position:fixed descendant scroll and stack with that section.
  // Rendering the modal into document.body keeps it above everything.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontFamily: "var(--font)", fontSize: 13, fontWeight: 600,
          color: "var(--accent-text)", textDecoration: "underline",
          textUnderlineOffset: 3, display: "inline-flex", alignItems: "center", gap: 6,
          ...style,
        }}
      >
        <span aria-hidden="true" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%", fontSize: 11, fontWeight: 700,
          border: "1.5px solid currentColor",
        }}>?</span>
        {label}
      </button>
      {open && mounted && createPortal(<MetricGuideModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
