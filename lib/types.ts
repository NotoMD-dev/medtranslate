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
}

export interface SentenceMetrics {
  pair_id: string;
  source: string;
  content_type: string;
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
  model_config: ModelConfig | null;
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
// Upload / dataset types
// ---------------------------------------------------------------------------

export interface TranslationPair {
  pair_id: string;
  source: "ClinSpEn_ClinicalCases" | "UMass_EHR";
  content_type: "clinical_case_report" | "ehr_clinical_note";
  english_reference: string;
  spanish_source: string;
  llm_english_translation: string;
}

// ---------------------------------------------------------------------------
// Translation configuration defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT =
  "You are a medical interpreter. Translate the following Spanish clinical text into English, preserving all medical terminology and clinical meaning.";

export interface TranslationConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_CONFIG: TranslationConfig = {
  model: "gpt-4o",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0,
  maxTokens: 1024,
};
