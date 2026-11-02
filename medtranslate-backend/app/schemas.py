"""Pydantic models for request/response validation."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


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
    model: str = "gpt-5.6-sol"
    system_prompt: Optional[str] = None
    # Temperature actually sent to the provider. ``None`` means the parameter
    # was not sent because the model rejects it (GPT-5.x reasoning models and
    # current Claude models); such runs are not deterministic.
    temperature: Optional[float] = 0.0
    max_tokens: int = 1024
    compute_bertscore: bool = False  # opt-in: avoids ~400MB torch load
    metrics_only: bool = False  # skip translation, only compute metrics (e.g. BERTScore)
    # Reasoning/thinking effort actually applied to this job's model (None when
    # the model does not take an effort setting). Recorded so results stay
    # reproducible and the UI can show how the run was configured.
    reasoning_effort: Optional[str] = None


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
    # failed_rows = refused_rows + incomplete_rows
    refused_rows: int = 0      # model declined / empty reply: scored as 0
    incomplete_rows: int = 0   # provider or config failure: unscored, retryable
    excluded_rows: int = 0     # refusals a reviewer marked legitimate: unscored


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
    # Exact error message from the provider / translator, if the row failed.
    error: Optional[str] = None
    # "refusal": the model declined or returned nothing; scored as 0 and sent
    #            to the top of the review queue.
    # "infrastructure": rate limit / connection / server / config failure;
    #            unscored and retryable.
    # "excluded": a refusal a reviewer judged legitimate (set on a metrics-only
    #            re-score); unscored and kept out of corpus BLEU.
    error_kind: Optional[str] = None
    # Heuristic description of wrapper text in the reply (preamble, note,
    # quotation marks, markdown). The text is never modified.
    format_warning: Optional[str] = None


class CorpusMetrics(BaseModel):
    bleu_score: float
    bleu_signature: str


class DatasetCorpusMetrics(BaseModel):
    overall: CorpusMetrics
    by_source: dict[str, CorpusMetrics] = {}
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
