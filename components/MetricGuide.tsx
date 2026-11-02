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
  oneLiner: string;
  howItWorks: string;
  /** The formula, kept to one line, plus a sentence naming each term. */
  howCalculated: { formula: string; terms: string };
  analogy: string;
  strictness: string;
  /** Plain-language score bands, lowest first. */
  bands: { range: string; meaning: string }[];
  gotcha: string;
}

export const METRIC_EXPLAINERS: MetricExplainer[] = [
  {
    key: "bleu",
    name: "SacreBLEU",
    range: "0 to 100",
    oneLiner: "How many exact phrases the AI translation shares with the human translation.",
    howItWorks:
      "It chops both translations into short chunks of 1, 2, 3, and 4 words in a row, then counts how many of the AI's chunks appear word-for-word in the human version. It is worked out for the whole file at once, not sentence by sentence.",
    howCalculated: {
      formula: "BLEU = 100 \u00d7 BP \u00d7 (p\u2081 \u00d7 p\u2082 \u00d7 p\u2083 \u00d7 p\u2084)^(1/4)",
      terms: "p\u2081 to p\u2084 are the fractions of the AI's 1-, 2-, 3-, and 4-word chunks that also appear in the human translation. BP is the brevity penalty: 1 when the AI output is at least as long as the human one, and less than 1 (exp(1 \u2212 reference length / AI length)) when it is shorter.",
    },
    analogy:
      "Imagine laying two essays side by side and highlighting every phrase that appears in both. More highlighting means a higher score.",
    strictness:
      "Very strict. \"Doctor\" and \"physician\" count as a miss. Extra words that are not in the human version pull the score down hard, and so does a translation that is much shorter than the human one.",
    bands: [
      { range: "Under 20", meaning: "Little word-for-word overlap. Could be a real problem, or the AI just rephrased a lot." },
      { range: "20 to 40", meaning: "Moderate overlap. Typical for good translations that use their own wording." },
      { range: "Over 40", meaning: "Very close to the human wording. Professional human translators often land in the 40s to 60s." },
    ],
    gotcha:
      "Because it is one number for the whole file, a small file (say 10 sentences) makes it jump around a lot. A score of 100 is not the goal; it would only mean the AI copied the human translation exactly.",
  },
  {
    key: "meteor",
    name: "METEOR",
    range: "0 to 1",
    oneLiner: "Like BLEU, but forgiving about synonyms and word forms, and it checks word order too.",
    howItWorks:
      "It lines up words between the two translations. A match counts if the words are identical, if they share a root (\"treat\" and \"treated\"), or if they are synonyms in a dictionary (\"doctor\" and \"physician\"). It then asks: did the AI cover everything in the human version? It also takes a little off if the matching words are in a scrambled order. Each sentence gets its own score, and the app shows the average.",
    howCalculated: {
      formula: "METEOR = F \u00d7 (1 \u2212 0.5 \u00d7 (chunks / matched words)\u00b3), where F = 10PR / (R + 9P)",
      terms: "P (precision) is the share of the AI's words that matched; R (recall) is the share of the human translation's words that matched. F weights recall nine times more than precision. \"Chunks\" counts how many runs of matched words are in the same order in both sentences, so a scrambled word order means more chunks and a bigger penalty.",
    },
    analogy:
      "A teacher grading a summary who accepts \"big\" for \"large\" and cares most about whether you covered all the key points, not whether you used the exact same words. Covering more of the key points means a higher score.",
    strictness:
      "Medium. It cares much more about missing content than about extra words, so a translation that adds a note or an explanation loses less here than it does on BLEU.",
    bands: [
      { range: "Under 0.4", meaning: "Flagged for physician review in this app. Something may be missing or very differently worded." },
      { range: "0.4 to 0.6", meaning: "Fair. Most of the meaning is there, but the wording differs a good deal." },
      { range: "0.6 to 0.75", meaning: "Good. Covers the human version well with similar wording." },
      { range: "Over 0.75", meaning: "Strong. Nearly the same content and wording." },
    ],
    gotcha:
      "The ± number shown next to the average is the spread between sentences. A big spread means some sentences scored very well and others poorly. When the target language is not English, word forms and synonyms are matched with that language's stemmer and dictionary where NLTK has them (Spanish, French, Portuguese, German, Russian and Arabic get stemming; Spanish, French, Portuguese, Japanese, Chinese and Arabic get synonyms); Chinese, Japanese and Korean are scored character by character.",
  },
  {
    key: "bertscore",
    name: "BERTScore F1",
    range: "0 to 1 (rescaled, can dip slightly below 0)",
    oneLiner: "Compares meaning instead of words, using an AI language model.",
    howItWorks:
      "Each word is turned into a point in \"meaning space\" by a language model (roberta-base when the target language is English, bert-base-multilingual-cased for any other target), and the score measures how close the AI translation's words are to the human translation's words in that space. \"The patient has no fever\" and \"Fever is absent\" score high even though almost no words match.",
    howCalculated: {
      formula: "F1 = 2PR / (P + R), then rescaled as (F1 \u2212 b) / (1 \u2212 b)",
      terms: "Every word in each sentence becomes a vector from the roberta-base model. R (recall) is the average, over the human translation's words, of each word's best cosine similarity to any AI word; P (precision) is the same in the other direction. b is a baseline similarity measured on random sentence pairs, so 0 means \"no better than random\" and 1 means identical.",
    },
    analogy:
      "Asking a bilingual friend \"do these two sentences mean the same thing?\" rather than counting matching words. The closer the two meanings, the higher the score.",
    strictness:
      "Loose on wording, strict on meaning. Rescaling makes 0 mean \"about as similar as two random sentences\" and 1 mean \"identical.\"",
    bands: [
      { range: "Under 0.5", meaning: "The meaning has drifted. Worth a close look." },
      { range: "0.5 to 0.8", meaning: "Similar meaning with noticeable differences." },
      { range: "Over 0.8", meaning: "Nearly the same meaning." },
    ],
    gotcha:
      "It is off by default because it needs a large model to run. Turn on \"Include BERTScore\" on the Translate page before running a job. When it was not computed, the app shows \"--\" and leaves it out of the head-to-head tally.",
  },
];

export const METRIC_GUIDE_NOTES = {
  sharedIdea:
    "All three scores compare the AI's translation against a human translation of the same sentence in the same target language (the \"reference\"). Higher is always better. None of them can tell whether the translation is medically safe; that is what the physician review step is for.",
  whyTheyDisagree: [
    "BLEU is strict about exact words, METEOR forgives synonyms, and BERTScore only cares about meaning. So the same translation can look bad on BLEU and fine on the other two.",
    "Low BLEU but decent METEOR and BERTScore usually means the AI rephrased, expanded abbreviations, or added extra words such as a note. That is not necessarily wrong.",
    "Low scores on all three usually mean a real translation problem, or a human reference that is itself loose or incomplete.",
  ],
  whatTheyMiss:
    "A single changed word can be dangerous (\"no fever\" vs \"fever\", \"5 mg\" vs \"50 mg\") yet barely move any of these scores. That is why pairs below the METEOR threshold go to a physician, and why a high score is never proof of safety.",
  headToHead:
    "On the Compare page, the model with the higher number wins that metric. Differences under 0.001 count as a tie. A metric that was not computed for either run is left out of the tally.",
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function MetricGuideModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <p style={{ margin: "0 0 20px", color: "var(--text-secondary)" }}>{METRIC_GUIDE_NOTES.sharedIdea}</p>

          {METRIC_EXPLAINERS.map((m) => (
            <section key={m.key} style={{ marginBottom: 24, padding: 18, background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>Score: {m.range}</span>
              </div>
              <p style={{ margin: "0 0 10px", fontWeight: 600, color: "var(--text-primary)" }}>{m.oneLiner}</p>
              <p style={{ margin: "0 0 8px", color: "var(--text-secondary)" }}><strong>How it works.</strong> {m.howItWorks}</p>
              <div style={{ margin: "0 0 10px", padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>How it is calculated</div>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13, color: "var(--text-primary)", overflowWrap: "anywhere", marginBottom: 4 }}>{m.howCalculated.formula}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>{m.howCalculated.terms}</div>
              </div>
              <p style={{ margin: "0 0 8px", color: "var(--text-secondary)" }}><strong>Think of it as.</strong> {m.analogy}</p>
              <p style={{ margin: "0 0 10px", color: "var(--text-secondary)" }}><strong>How strict is it?</strong> {m.strictness}</p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10, fontSize: 13 }}>
                <tbody>
                  {m.bands.map((b) => (
                    <tr key={b.range}>
                      <td style={{ padding: "5px 8px 5px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top", width: 110, borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>{b.range}</td>
                      <td style={{ padding: "5px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", fontSize: 13 }}>{b.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}><strong>Good to know.</strong> {m.gotcha}</p>
            </section>
          ))}

          <section style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Why do the scores disagree with each other?</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: "var(--text-secondary)" }}>
              {METRIC_GUIDE_NOTES.whyTheyDisagree.map((t) => <li key={t} style={{ marginBottom: 4 }}>{t}</li>)}
            </ul>
          </section>

          <section style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>What the scores cannot see</div>
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>{METRIC_GUIDE_NOTES.whatTheyMiss}</p>
          </section>

          <section>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>How the head-to-head winner is picked</div>
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>{METRIC_GUIDE_NOTES.headToHead}</p>
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
