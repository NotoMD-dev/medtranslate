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
  total: number;
  translated: number;
  scored: number;
  failed_rows: number;
  error: string | null;
  bertscore_completed: number;
  bertscore_total: number;
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
  error: string | null;
}

export interface CorpusMetrics {
  bleu_score: number;
  bleu_signature: string;
}

export interface DatasetCorpusMetrics {
  overall: CorpusMetrics;
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
  temperature: number;
  max_tokens: number;
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
    label: "No error",
    color: "#10b981",
    bg: "#ecfdf5",
    description: "LLM translation accurately preserves clinical meaning",
  },
  {
    grade: 1,
    label: "Minor linguistic",
    color: "#f59e0b",
    bg: "#fffbeb",
    description: "Stylistic or grammatical difference, no change in clinical meaning",
  },
  {
    grade: 2,
    label: "Moderate error",
    color: "#f97316",
    bg: "#fff7ed",
    description: "Potential for confusion, unlikely to change clinical management",
  },
  {
    grade: 3,
    label: "Clinically significant",
    color: "#ef4444",
    bg: "#fef2f2",
    description: "Could alter diagnosis, treatment, or disposition",
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
  english_reference: string;
  source_text: string;
  /** @deprecated Kept for backward-compatible CSV export; mirrors source_text */
  spanish_source: string;
  llm_english_translation: string;
}

// ---------------------------------------------------------------------------
// Supported source languages
// ---------------------------------------------------------------------------

export interface SourceLanguageOption {
  code: string;
  label: string;
  /** Column name expected in the CSV/XLSX (e.g. "spanish_source") */
  columnName: string;
}

export const SOURCE_LANGUAGES: SourceLanguageOption[] = [
  { code: "es", label: "Spanish", columnName: "spanish_source" },
  { code: "fr", label: "French", columnName: "french_source" },
  { code: "ko", label: "Korean", columnName: "korean_source" },
  { code: "zh", label: "Chinese", columnName: "chinese_source" },
  { code: "pt", label: "Portuguese", columnName: "portuguese_source" },
  { code: "de", label: "German", columnName: "german_source" },
  { code: "ar", label: "Arabic", columnName: "arabic_source" },
  { code: "ja", label: "Japanese", columnName: "japanese_source" },
  { code: "ru", label: "Russian", columnName: "russian_source" },
];

export const DEFAULT_SOURCE_LANGUAGE = SOURCE_LANGUAGES[0]; // Spanish

// ---------------------------------------------------------------------------
// Supported LLM models
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-5.1", label: "GPT 5.1", provider: "openai" },
  { id: "gpt-5.2", label: "GPT 5.2", provider: "openai" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
];

// ---------------------------------------------------------------------------
// Translation configuration defaults
// ---------------------------------------------------------------------------

export function buildSystemPrompt(languageLabel: string): string {
  return `You are a medical interpreter. Translate the following ${languageLabel} clinical text into English, preserving all medical terminology and clinical meaning.`;
}

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt("Spanish");

export interface TranslationConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  sourceLanguage?: string;
}

export const DEFAULT_CONFIG: TranslationConfig = {
  model: "gpt-4o",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0,
  maxTokens: 1024,
  sourceLanguage: "es",
};
