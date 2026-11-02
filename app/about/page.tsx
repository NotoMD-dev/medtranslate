"use client";

import { useEffect, useRef, useState } from "react";
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
    title: "Safety Review",
    text: "Sentences that score poorly on METEOR (below 0.4 by default) are flagged, and any sentence the model refused to translate goes to the top of the queue. A physician reads the original, the human translation, and the AI translation side by side and grades how serious any error is, from 0 (no error) to 3 (could change care).",
  },
  {
    title: "Compare",
    text: "Run the same file through the second model (one click on the Compare page) and the two runs go head to head, metric by metric, with the sentences where they differed most. Open any of those sentences to read both outputs side by side and record which one is actually better.",
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
const LINK: React.CSSProperties = { color: "var(--accent-text)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 };

// ---------------------------------------------------------------------------
// About Creator
// ---------------------------------------------------------------------------

/**
 * Shown in the "About Creator" section. `email` drives the "Contact me"
 * popup (shows the address with copy and open-in-mail-app actions); leave
 * it empty to hide the button.
 */
const CREATOR = {
  name: "Yasmine Abbey",
  credentials: "MD, MSc",
  initials: "YA",
  tagline: ["Internal medicine", "inpatient tooling", "AI-assisted builds"],
  /** Public contact address shown in the "Contact me" popup. Empty hides the button. */
  email: "yasmineabbey@gmail.com",
  website: "https://scopemd.net",
  websiteLabel: "scopeMD",
  formerly: "notomed.dev",
  emailSubject: "MedTranslate question",
};

/**
 * "Contact me" button that opens a small popup with the email address, a
 * copy button and an open-in-mail-app link, like the contact card on
 * scopeMD. Closes on Escape, on a click outside, or with the close button.
 */
function ContactButton({ email, subject }: { email: string; subject: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, permissions): select the text instead.
      const el = wrapRef.current?.querySelector<HTMLElement>("[data-email]");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  const mailto = `mailto:${email}?subject=${encodeURIComponent(subject)}`;

  return (
    <div ref={wrapRef} className="contact-wrap">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 600, padding: "10px 20px", borderRadius: "var(--radius-sm)", background: open ? "var(--accent-soft)" : "transparent", color: "var(--accent-text)", border: "1.5px solid var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Contact me
      </button>
      {open && (
        <div role="dialog" aria-label="Contact" className="contact-popup">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Email</div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, color: "var(--text-muted)", padding: 0 }}>&times;</button>
          </div>
          <div data-email style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere", marginBottom: 12, userSelect: "all" }}>{email}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={copy}
              style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: "var(--radius-xs)", background: copied ? "var(--accent-soft)" : "var(--bg-inset)", color: copied ? "var(--accent-text)" : "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a
              href={mailto}
              style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: "var(--radius-xs)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}
            >
              Open in mail app
            </a>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Subject will be prefilled: &ldquo;{subject}&rdquo;</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: "purpose", label: "Purpose" },
  { id: "how-a-run-works", label: "How a run works" },
  { id: "models", label: "Models and effort" },
  { id: "scores", label: "Reading the scores" },
  { id: "grading", label: "Physician grading scale" },
  { id: "data", label: "Data" },
  { id: "creator", label: "About Creator" },
  { id: "caveat", label: "Not a clinical tool" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Sticky list of links to each section. The current section is tracked
 * with an IntersectionObserver so the highlight follows the reader as
 * they scroll; clicking a link scrolls smoothly and updates the hash.
 */
function SectionNav() {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<SectionId, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id as SectionId;
          if (e.isIntersecting) visible.set(id, e.intersectionRatio);
          else visible.delete(id);
        }
        // Highlight the topmost visible section (sections are observed in
        // page order, so the first id in SECTIONS that is visible wins).
        const first = SECTIONS.find((sec) => visible.has(sec.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] },
    );
    for (const sec of SECTIONS) {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // On narrow screens the links are a horizontally scrolling row; keep the
  // active one in view as the reader scrolls the page.
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".about-nav");
    const link = nav?.querySelector<HTMLElement>("a.active");
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    const left = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  const go = (id: SectionId) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <aside className="about-sidebar" aria-label="On this page">
      <div className="about-sidebar-title">On this page</div>
      <nav className="about-nav">
        {SECTIONS.map((sec) => (
          <a
            key={sec.id}
            href={`#${sec.id}`}
            onClick={go(sec.id)}
            className={active === sec.id ? "active" : undefined}
            aria-current={active === sec.id ? "location" : undefined}
          >
            {sec.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

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

      <div className="about-layout">
      <SectionNav />
      <div className="about-content">

      {/* Purpose */}
      <div id="purpose" className="anim d1 about-section" style={{ marginBottom: 48 }}>
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
      <div id="how-a-run-works" className="anim d2 about-section" style={{ marginBottom: 48 }}>
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
      <div id="models" className="anim d3 about-section" style={{ marginBottom: 48 }}>
        <SectionLabel>Models and effort</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
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
                  <td className="wrap" style={{ fontSize: 13, lineHeight: 1.6, minWidth: 260 }}>{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-secondary)" }}>Why these two.</strong> Each is its provider&rsquo;s flagship model, so the study compares flagship against flagship at the same effort. A smaller model such as Claude Sonnet is cheaper and still good, but it would not answer the question the study asks. More models and per-run effort settings are planned.
        </p>
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
      <div id="scores" className="anim d4 about-section" style={{ marginBottom: 48 }}>
        <SectionLabel>Reading the scores</SectionLabel>
        <Card>
          <p style={P}>{METRIC_GUIDE_NOTES.intro.scope} {METRIC_GUIDE_NOTES.intro.uses}</p>
          <div style={{ display: "grid", gap: 14, marginBottom: 16 }}>
            {METRIC_EXPLAINERS.map((m) => (
              <div key={m.key} style={{ padding: 16, background: "var(--bg-inset)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{m.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>{m.range}</span>
                </div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{m.simple.join(" ")} {m.analogy}</div>
              </div>
            ))}
          </div>
          <p style={{ ...P, fontSize: 14 }}>{METRIC_GUIDE_NOTES.intro.caution}</p>
          <MetricGuideLink label="Open complete explanation guide" />
        </Card>
      </div>

      {/* Clinical grades */}
      <div id="grading" className="anim d5 about-section" style={{ marginBottom: 48 }}>
        <SectionLabel>Physician grading scale</SectionLabel>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
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
                  <td className="wrap" style={{ fontSize: 14, lineHeight: 1.6, minWidth: 240 }}>{g.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.6 }}>
          Reviewers can also flag the human reference itself when it looks wrong, so a low score caused by a weak reference is not blamed on the AI.
        </p>
      </div>

      {/* Data */}
      <div id="data" className="anim d5 about-section" style={{ marginBottom: 48 }}>
        <SectionLabel>Data</SectionLabel>
        <Card>
          <p style={P}>
            MedTranslate is a research tool developed and evaluated using two Spanish&ndash;English clinical datasets: <a href="https://zenodo.org/records/7711516" target="_blank" rel="noopener noreferrer" style={LINK}>ClinSpEn</a>, which contains professionally translated COVID-19 clinical case reports, and the <a href="https://aclanthology.org/W15-3816/" target="_blank" rel="noopener noreferrer" style={LINK}>UMass EHR corpus</a>, which contains de-identified clinical notes. Both provide aligned Spanish and English clinical text. In this evaluation, the Spanish text is translated into English by each LLM, and the resulting translation is compared with the corresponding original English text using the scoring metrics described on this page.
          </p>
          <p style={P}>
            You can also evaluate translations using your own dataset. The uploaded file must include a column containing the source-language text&mdash;for example, <code>spanish_source</code> or <code>french_source</code>&mdash;and an <code>english_reference</code> column containing the corresponding human-translated English text. The tool supports Spanish, French, Korean, Chinese, Portuguese, German, Arabic, Japanese, and Russian.
          </p>
          <p style={{ ...P, marginBottom: 0 }}>
            To try MedTranslate without providing your own dataset, the <Link href="/" style={LINK}>Upload page</Link> includes small synthetic Spanish and French demonstration files. These files contain no real patient data.
          </p>
        </Card>
      </div>

      {/* About Creator. Lifted above the sections that follow so the contact
          popup is not painted under the next animated section. */}
      <div id="creator" className="anim d5 about-section" style={{ marginBottom: 48, position: "relative", zIndex: 2 }}>
        <SectionLabel>About Creator</SectionLabel>
        <Card>
          <div className="creator-card">
            <div className="creator-mark" aria-hidden="true">{CREATOR.initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                Hi, I&rsquo;m {CREATOR.name.split(" ")[0]} <span aria-hidden="true">&#128075;</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
                <strong style={{ color: "var(--text-secondary)" }}>{CREATOR.name}, {CREATOR.credentials}</strong>
                {" "}&middot; {CREATOR.tagline.join(" \u00b7 ")}
              </div>
              <p style={{ ...P, fontSize: 14 }}>
                I am an Internal Medicine physician, recently graduated from Cedars-Sinai. Much of my daily work involved recurring, cognitively heavy tasks with few streamlined, web-based tools to lighten the load, so I started building my own and sharing them. That became{" "}
                <a href={CREATOR.website} target="_blank" rel="noopener noreferrer" style={LINK}>{CREATOR.websiteLabel}</a>
                {" "}(formerly {CREATOR.formerly}): a collection of physician-built tools meant to reduce cognitive load, standardize workflows, and make on-service life a little easier.
              </p>
              <p style={{ ...P, fontSize: 14 }}>
                MedTranslate comes from the same place. Hospitals see patients who speak many languages, interpreters are not always available, and AI translation is tempting. Before anyone relies on it, its mistakes need to be counted. I am a largely self-taught developer, and this site was pieced together with determination and help from LLMs, so if you find it useful, please share it or tell me how to make it better.
              </p>
              <p style={{ ...P, fontSize: 14, marginBottom: 16 }}>
                Questions about the methods, the datasets, or the scores? Found a translation the scores got wrong? Want to run the study on your own corpus? Get in touch.
              </p>
              <div className="button-row">
                <a
                  href={CREATOR.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 600, padding: "10px 20px", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  Visit {CREATOR.websiteLabel}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                {CREATOR.email && <ContactButton email={CREATOR.email} subject={CREATOR.emailSubject} />}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Caveat */}
      <div id="caveat" className="anim d5 about-section" style={{ marginBottom: 48 }}>
        <Card style={{ borderLeft: "4px solid var(--warning)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Not a clinical tool</div>
          <p style={{ ...P, marginBottom: 0, fontSize: 14 }}>
            MedTranslate is a research tool for comparing AI-generated translations with reference English text. SacreBLEU, METEOR, and BERTScore measure different aspects of translation similarity. MedTranslate is designed to study whether these scores, alone or together, correspond with clinician assessments of translation accuracy and safety. Until that relationship is validated, the scores should not be used on their own to guide patient care.
          </p>
        </Card>
      </div>

      </div>
      </div>
    </div>
  );
}
