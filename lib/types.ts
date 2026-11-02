// ---------------------------------------------------------------------------
// Backend job types (mirror the FastAPI schemas)
// ---------------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export interface JobCreated {
  job_id: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  /** queued | translating | meteor | bleu | bertscore | complete | failed | cancelled */
  phase?: string;
  total: number;
  translated: number;
  scored: number;
  failed_rows: number;
  error: string | null;
  bertscore_completed: number;
  bertscore_total: number;
  /** Model declined or returned nothing; scored as 0. Older backends omit this. */
  refused_rows?: number;
  /** Provider/config failure; unscored and retryable. Older backends omit this. */
  incomplete_rows?: number;
  /** Refusals a reviewer marked legitimate; excluded from all scores. */
  excluded_rows?: number;
}

/**
 * Why a row has no translation.
 * - "refusal": the model declined or returned an empty reply. Counts against
 *   the model (METEOR 0, BERTScore 0, empty BLEU hypothesis) and goes to the
 *   top of the review queue.
 * - "infrastructure": rate limit, connection, server, or configuration
 *   failure. Says nothing about the model; unscored and retryable.
 */
export type ErrorKind = "refusal" | "infrastructure" | "excluded";

/**
 * Reviewer's head-to-head preference for one sentence: which model's output
 * is actually the better translation, regardless of the automated scores.
 * `preferred` is a model id or "tie". Keyed by pair_id in session storage.
 */
export interface HeadToHeadJudgment {
  preferred: string;
  note: string;
  /** The two model ids that were compared when the judgment was made. */
  models: [string, string];
  /** ISO timestamp of the decision. */
  at: string;
}

/**
 * Reviewer decision that a refusal was legitimate (e.g. the source text is
 * not translatable or not clinical). Keyed by pair_id in session storage and
 * applied to every model's run for that pair, since it is a property of the
 * source sentence, not of the model.
 */
export interface RefusalOverride {
  note: string;
  /** ISO timestamp of the decision. */
  at: string;
}

export interface SentenceMetrics {
  pair_id: string;
  source: string;
  content_type: string;
  source_text: string;
  /** @deprecated Backend still returns spanish_source for backward compat */
  spanish_source: string;
  english_reference: string;
  llm_english_translation: string;
  meteor: number | null;
  bertscore_f1: number | null;
  /** Exact error message if the row failed. */
  error: string | null;
  /** Failure class; null/undefined when the row succeeded (or on older results). */
  error_kind?: ErrorKind | null;
  /** Heuristic note when the reply looks wrapped (preamble, note, quotes, markdown). */
  format_warning?: string | null;
}

export interface CorpusMetrics {
  bleu_score: number;
  bleu_signature: string;
}

export interface DatasetCorpusMetrics {
  overall: CorpusMetrics;
  by_source?: Record<string, CorpusMetrics>;
  clinspen: CorpusMetrics | null;
  umass: CorpusMetrics | null;
}

export interface LibraryVersions {
  sacrebleu: string;
  nltk: string;
  bert_score?: string;
  torch?: string;
}

export interface ModelConfig {
  model: string;
  system_prompt: string | null;
  /** Temperature actually sent to the provider, or null if the model rejects it (not sent). */
  temperature: number | null;
  max_tokens: number;
  /** Reasoning/thinking effort the backend applied, or null if not applicable. */
  reasoning_effort?: string | null;
  /** Translation direction as language codes (see LANGUAGES). Older runs carry none and were Spanish to English. */
  source_language?: string | null;
  target_language?: string | null;
}

export interface JobResults {
  job_id: string;
  status: JobStatus;
  corpus_metrics: DatasetCorpusMetrics | null;
  sentence_metrics: SentenceMetrics[];
  library_versions: LibraryVersions | null;
  translation_config: ModelConfig | null;
  total?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Clinical grading (unchanged)
// ---------------------------------------------------------------------------

export type ClinicalGrade = 0 | 1 | 2 | 3;

export interface ClinicalGradeInfo {
  grade: ClinicalGrade;
  label: string;
  color: string;
  bg: string;
  description: string;
}

export const CLINICAL_GRADES: ClinicalGradeInfo[] = [
  {
    grade: 0,
    label: "No Error",
    color: "#10b981",
    bg: "#ecfdf5",
    description: "Translation accurately preserves the clinical meaning of the source text",
  },
  {
    grade: 1,
    label: "Minor Linguistic Error",
    color: "#f59e0b",
    bg: "#fffbeb",
    description: "Stylistic or grammatical difference that does not change the clinical meaning of the source text",
  },
  {
    grade: 2,
    label: "Addition or Omission Error",
    color: "#f97316",
    bg: "#fff7ed",
    description: "Translation contains addition or omission errors that do not change the meaning of the original clinical context",
  },
  {
    grade: 3,
    label: "Clinically Significant Error",
    color: "#ef4444",
    bg: "#fef2f2",
    description: "Translation error that could lead to a clinically significant change in diagnosis, treatment, or patient disposition (e.g., omitted negation, incorrect dosage or frequency, severity misrepresentation)",
  },
];

// ---------------------------------------------------------------------------
// Reference quality flags (reviewer flags gold-standard issues)
// ---------------------------------------------------------------------------

export type ReferenceFlagReason =
  | "inaccurate"
  | "extra_info"
  | "missing_info"
  | "wrong_meaning"
  | "llm_better";

export interface ReferenceFlagReasonInfo {
  reason: ReferenceFlagReason;
  label: string;
  description: string;
}

export const REFERENCE_FLAG_REASONS: ReferenceFlagReasonInfo[] = [
  { reason: "inaccurate", label: "Inaccurate", description: "Reference translation is not an accurate translation of the source" },
  { reason: "extra_info", label: "Extra info", description: "Reference contains information not present in the source text" },
  { reason: "missing_info", label: "Missing info", description: "Reference omits information present in the source text" },
  { reason: "wrong_meaning", label: "Wrong meaning", description: "Reference conveys a different clinical meaning than the source" },
  { reason: "llm_better", label: "LLM is better", description: "LLM translation appears more accurate than the reference" },
];

export interface ReferenceFlag {
  reasons: ReferenceFlagReason[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Upload / dataset types
// ---------------------------------------------------------------------------

export interface TranslationPair {
  pair_id: string;
  source: string;
  content_type: string;
  /** Human reference translation in the target language. The field name predates support for targets other than English. */
  english_reference: string;
  source_text: string;
  /** @deprecated Kept for backward-compatible CSV export; mirrors source_text */
  spanish_source: string;
  llm_english_translation: string;
}

// ---------------------------------------------------------------------------
// Supported languages
// ---------------------------------------------------------------------------

export interface LanguageOption {
  code: string;
  label: string;
  /** Lowercase name used in column names: "<name>_source" and "<name>_reference". */
  name: string;
}

/**
 * Languages the app can translate between, in either direction. Keep in sync
 * with LANGUAGES in medtranslate-backend/app/config.py.
 */
export const LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", name: "english" },
  { code: "es", label: "Spanish", name: "spanish" },
  { code: "fr", label: "French", name: "french" },
  { code: "ko", label: "Korean", name: "korean" },
  { code: "zh", label: "Chinese", name: "chinese" },
  { code: "pt", label: "Portuguese", name: "portuguese" },
  { code: "de", label: "German", name: "german" },
  { code: "ar", label: "Arabic", name: "arabic" },
  { code: "ja", label: "Japanese", name: "japanese" },
  { code: "ru", label: "Russian", name: "russian" },
];

export const DEFAULT_SOURCE_LANGUAGE = LANGUAGES[1]; // Spanish
export const DEFAULT_TARGET_LANGUAGE = LANGUAGES[0]; // English

export function languageByCode(code: string | null | undefined): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** "es" -> "Spanish". Unknown codes are returned as-is so nothing renders blank. */
export function languageLabel(code: string | null | undefined): string {
  return languageByCode(code)?.label ?? (code || "");
}

/** Column that holds the text to translate for a source language ("spanish_source"). */
export function sourceColumnFor(code: string): string {
  return `${languageByCode(code)?.name ?? code}_source`;
}

/** Column that holds the human reference for a target language ("english_reference"). */
export function referenceColumnFor(code: string): string {
  return `${languageByCode(code)?.name ?? code}_reference`;
}

/** Source language of a run; older runs carry none and were Spanish to English. */
export function sourceLanguageOf(config: ModelConfig | null | undefined): string {
  return config?.source_language || DEFAULT_SOURCE_LANGUAGE.code;
}

/** Target language of a run; older runs carry none and were Spanish to English. */
export function targetLanguageOf(config: ModelConfig | null | undefined): string {
  return config?.target_language || DEFAULT_TARGET_LANGUAGE.code;
}

/** Model BERTScore uses for a target language. Keep in sync with bertscore_model() in the backend. */
export function bertscoreModelFor(targetCode: string): string {
  return targetCode === "en" ? "roberta-base" : "bert-base-multilingual-cased";
}

// ---------------------------------------------------------------------------
// Supported LLM models
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
}

/**
 * The two models under study. Both are their provider's flagship, so the
 * comparison is like for like; both run at medium reasoning effort by default
 * (see OPENAI_REASONING_EFFORT / ANTHROPIC_EFFORT on the backend).
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic" },
];

/** Labels for model ids that older saved runs may still carry. */
export const LEGACY_MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (retired)",
  "gpt-4o": "GPT-4o (retired)",
};

export function modelLabel(id: string): string {
  return MODEL_OPTIONS.find((m) => m.id === id)?.label ?? LEGACY_MODEL_LABELS[id] ?? id;
}

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

/**
 * Map a stored model id to one that is currently offered. Older sessions may
 * still hold ids of retired models (e.g. "gpt-4o"); those fall back to the
 * default so a run never targets a model the providers no longer serve.
 */
export function resolveModelId(id: string | undefined | null): string {
  return id && MODEL_OPTIONS.some((m) => m.id === id) ? id : DEFAULT_MODEL_ID;
}

// ---------------------------------------------------------------------------
// Translation configuration defaults
// ---------------------------------------------------------------------------

/**
 * Keep in sync with DEFAULT_SYSTEM_PROMPT in medtranslate-backend/app/config.py.
 * The final sentence matters for scoring: metrics compare the whole reply to
 * the reference, so a preamble or note counts as translation text and lowers
 * BLEU sharply while barely moving METEOR.
 */
export function buildSystemPrompt(sourceCode: string, targetCode: string): string {
  const src = languageLabel(sourceCode);
  const tgt = languageLabel(targetCode);
  return `You are a medical interpreter. Translate the following ${src} clinical text into ${tgt}, preserving all medical terminology and clinical meaning. Output only the ${tgt} translation, with no preamble, notes, quotation marks, or explanations.`;
}

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt(DEFAULT_SOURCE_LANGUAGE.code, DEFAULT_TARGET_LANGUAGE.code);

export interface TranslationConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export const DEFAULT_CONFIG: TranslationConfig = {
  model: DEFAULT_MODEL_ID,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0,
  maxTokens: 1024,
  sourceLanguage: "es",
};
