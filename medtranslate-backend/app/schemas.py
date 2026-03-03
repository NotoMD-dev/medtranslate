"""Pydantic models for request/response validation."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    complete = "complete"
    failed = "failed"
    cancelled = "cancelled"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ModelConfig(BaseModel):
    model: str = "gpt-4o"
    system_prompt: Optional[str] = None
    temperature: float = 0.0
    max_tokens: int = 1024
    compute_bertscore: bool = False  # opt-in: avoids ~400MB torch load
    metrics_only: bool = False  # skip translation, only compute metrics (e.g. BERTScore)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class JobCreated(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    total: int = 0
    translated: int = 0
    scored: int = 0
    failed_rows: int = 0
    error: Optional[str] = None
    bertscore_completed: int = 0
    bertscore_total: int = 0


class SentenceMetrics(BaseModel):
    pair_id: str
    source: str
    content_type: str
    source_text: str = ""
    spanish_source: str = ""  # backward compat
    english_reference: str
    llm_english_translation: str
    meteor: Optional[float] = None
    bertscore_f1: Optional[float] = None
    error: Optional[str] = None


class CorpusMetrics(BaseModel):
    bleu_score: float
    bleu_signature: str


class DatasetCorpusMetrics(BaseModel):
    overall: CorpusMetrics
    by_source: dict[str, CorpusMetrics] = Field(default_factory=dict)
    # Backward-compatible aliases used by existing frontend views
    clinspen: Optional[CorpusMetrics] = None
    umass: Optional[CorpusMetrics] = None


class LibraryVersions(BaseModel):
    sacrebleu: str
    nltk: str
    bert_score: str = "not loaded"
    torch: str = "not loaded"


class JobResults(BaseModel):
    job_id: str
    status: JobStatus
    corpus_metrics: Optional[DatasetCorpusMetrics] = None
    sentence_metrics: list[SentenceMetrics] = []
    library_versions: Optional[LibraryVersions] = None
    translation_config: Optional[ModelConfig] = None
    total: int = 0
    offset: int = 0
