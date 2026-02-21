export interface TranslationPair {
  pair_id: string;
  source: "ClinSpEn_ClinicalCases" | "UMass_EHR";
  content_type: "clinical_case_report" | "ehr_clinical_note";
  english_reference: string;
  spanish_source: string;
  llm_english_translation: string;
}

export interface TranslationResult extends TranslationPair {
  _index: number;
  _status: "pending" | "translating" | "scoring" | "complete" | "error";
  _bleu: number | null;
  _meteor: number | null;
  _bert_proxy: number | null;
  _clinical_grade: ClinicalGrade | null;
  _error_message?: string;
}

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

export interface MetricsSummary {
  count: number;
  bleu: { mean: number; std: number; min: number; max: number };
  meteor: { mean: number; std: number; min: number; max: number };
  bert_proxy: { mean: number; std: number; min: number; max: number };
}

export interface TranslationConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_SYSTEM_PROMPT =
  "You are a medical interpreter. Translate the following Spanish clinical text into English, preserving all medical terminology and clinical meaning. Output ONLY the English translation, nothing else.";

export const DEFAULT_CONFIG: TranslationConfig = {
  model: "gpt-5.2",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0,
  maxTokens: 1024,
};
