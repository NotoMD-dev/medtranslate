"""In-memory job store and background job execution logic."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.metrics import (
    compute_bertscore_batch,
    compute_corpus_bleu,
    compute_meteor,
    get_library_versions,
)
from app.schemas import (
    CorpusMetrics,
    DatasetCorpusMetrics,
    JobResults,
    JobStatus,
    JobStatusResponse,
    LibraryVersions,
    ModelConfig,
    SentenceMetrics,
)
from app.translate import translate_text

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Row data parsed from CSV upload
# ---------------------------------------------------------------------------

@dataclass
class InputRow:
    pair_id: str
    source: str
    content_type: str
    spanish_source: str
    english_reference: str
    llm_english_translation: str = ""


# ---------------------------------------------------------------------------
# Per-job state
# ---------------------------------------------------------------------------

@dataclass
class Job:
    job_id: str
    status: JobStatus = JobStatus.queued
    rows: list[InputRow] = field(default_factory=list)
    model_config: ModelConfig = field(default_factory=ModelConfig)

    # Progress counters
    translated: int = 0
    scored: int = 0
    failed_rows: int = 0

    # Results (populated during/after execution)
    sentence_metrics: list[SentenceMetrics] = field(default_factory=list)
    corpus_metrics: Optional[DatasetCorpusMetrics] = None
    library_versions: Optional[LibraryVersions] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

_jobs: dict[str, Job] = {}


def create_job(rows: list[InputRow], config: ModelConfig) -> str:
    """Create a new job and return its ID."""
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id, rows=rows, model_config=config)
    _jobs[job_id] = job
    return job_id


def get_job(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)


def get_job_status(job_id: str) -> Optional[JobStatusResponse]:
    job = _jobs.get(job_id)
    if job is None:
        return None
    return JobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        total=len(job.rows),
        translated=job.translated,
        scored=job.scored,
        failed_rows=job.failed_rows,
        error=job.error,
    )


def get_job_results(job_id: str) -> Optional[JobResults]:
    job = _jobs.get(job_id)
    if job is None:
        return None
    return JobResults(
        job_id=job.job_id,
        status=job.status,
        corpus_metrics=job.corpus_metrics,
        sentence_metrics=job.sentence_metrics,
        library_versions=job.library_versions,
        model_config=job.model_config,
    )


# ---------------------------------------------------------------------------
# Job execution (runs in background task)
# ---------------------------------------------------------------------------

async def execute_job(job_id: str) -> None:
    """Run translation + metric computation for a job.

    This is designed to be launched as a background asyncio task so
    it does not block the API thread.
    """
    job = _jobs.get(job_id)
    if job is None:
        return

    job.status = JobStatus.running
    total = len(job.rows)
    logger.info("Job %s: starting (%d rows)", job_id, total)

    # ------------------------------------------------------------------
    # Phase 1: Translate row-by-row
    # ------------------------------------------------------------------
    system_prompt = job.model_config.system_prompt or ""
    model = job.model_config.model
    temperature = job.model_config.temperature
    max_tokens = job.model_config.max_tokens

    for i, row in enumerate(job.rows):
        try:
            translation = await translate_text(
                row.spanish_source,
                model=model,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            row.llm_english_translation = translation
            job.translated += 1
        except Exception as exc:
            logger.error("Job %s row %d translation failed: %s", job_id, i, exc)
            row.llm_english_translation = ""
            job.failed_rows += 1
            # Store partial failure but continue processing
            job.sentence_metrics.append(
                SentenceMetrics(
                    pair_id=row.pair_id,
                    source=row.source,
                    content_type=row.content_type,
                    spanish_source=row.spanish_source,
                    english_reference=row.english_reference,
                    llm_english_translation="",
                    error=str(exc),
                )
            )
            continue

        # Yield control periodically so the event loop remains responsive
        if (i + 1) % 5 == 0:
            await asyncio.sleep(0)

    # ------------------------------------------------------------------
    # Phase 2: Compute sentence-level metrics (METEOR)
    # ------------------------------------------------------------------
    logger.info("Job %s: computing sentence-level METEOR", job_id)

    successfully_translated: list[tuple[int, InputRow]] = [
        (i, row)
        for i, row in enumerate(job.rows)
        if row.llm_english_translation and row.english_reference
    ]

    meteor_scores: list[Optional[float]] = []
    for idx, (i, row) in enumerate(successfully_translated):
        try:
            m = compute_meteor(row.llm_english_translation, row.english_reference)
            meteor_scores.append(m)
        except Exception as exc:
            logger.error("Job %s row %d METEOR failed: %s", job_id, i, exc)
            meteor_scores.append(None)
        job.scored = idx + 1

        # Yield periodically
        if (idx + 1) % 20 == 0:
            await asyncio.sleep(0)

    # ------------------------------------------------------------------
    # Phase 3: Compute BERTScore in batch
    # ------------------------------------------------------------------
    logger.info("Job %s: computing BERTScore", job_id)

    candidates_for_bert = [
        row.llm_english_translation for _, row in successfully_translated
    ]
    references_for_bert = [
        row.english_reference for _, row in successfully_translated
    ]

    try:
        bert_f1_scores = await asyncio.to_thread(
            compute_bertscore_batch, candidates_for_bert, references_for_bert
        )
    except Exception as exc:
        logger.error("Job %s BERTScore batch failed: %s", job_id, exc)
        bert_f1_scores = [None] * len(candidates_for_bert)

    # ------------------------------------------------------------------
    # Phase 4: Build sentence metrics list
    # ------------------------------------------------------------------
    # First, rebuild sentence_metrics from scratch (clear partial failures added earlier)
    sentence_metrics_map: dict[str, SentenceMetrics] = {}

    # Add failed rows first
    for sm in job.sentence_metrics:
        sentence_metrics_map[sm.pair_id] = sm

    for idx, (i, row) in enumerate(successfully_translated):
        bert_val = bert_f1_scores[idx] if idx < len(bert_f1_scores) else None
        meteor_val = meteor_scores[idx] if idx < len(meteor_scores) else None
        sentence_metrics_map[row.pair_id] = SentenceMetrics(
            pair_id=row.pair_id,
            source=row.source,
            content_type=row.content_type,
            spanish_source=row.spanish_source,
            english_reference=row.english_reference,
            llm_english_translation=row.llm_english_translation,
            meteor=meteor_val,
            bertscore_f1=float(bert_val) if bert_val is not None else None,
        )

    # Add rows without references (translated but no metrics)
    for row in job.rows:
        if row.pair_id not in sentence_metrics_map:
            sentence_metrics_map[row.pair_id] = SentenceMetrics(
                pair_id=row.pair_id,
                source=row.source,
                content_type=row.content_type,
                spanish_source=row.spanish_source,
                english_reference=row.english_reference,
                llm_english_translation=row.llm_english_translation,
            )

    # Preserve original row order
    job.sentence_metrics = [
        sentence_metrics_map[row.pair_id]
        for row in job.rows
        if row.pair_id in sentence_metrics_map
    ]

    # ------------------------------------------------------------------
    # Phase 5: Compute corpus BLEU (sacrebleu)
    # ------------------------------------------------------------------
    logger.info("Job %s: computing corpus BLEU", job_id)

    all_hyps = [row.llm_english_translation for _, row in successfully_translated]
    all_refs = [row.english_reference for _, row in successfully_translated]

    try:
        overall_score, overall_sig = compute_corpus_bleu(all_hyps, all_refs)
        overall_corpus = CorpusMetrics(bleu_score=overall_score, bleu_signature=overall_sig)
    except Exception as exc:
        logger.error("Job %s overall corpus BLEU failed: %s", job_id, exc)
        overall_corpus = CorpusMetrics(bleu_score=0.0, bleu_signature=f"error: {exc}")

    # Per-dataset corpus BLEU
    clinspen_corpus = None
    umass_corpus = None

    clinspen_pairs = [
        (row.llm_english_translation, row.english_reference)
        for _, row in successfully_translated
        if row.source == "ClinSpEn_ClinicalCases"
    ]
    if clinspen_pairs:
        try:
            cs_hyps, cs_refs = zip(*clinspen_pairs)
            cs_score, cs_sig = compute_corpus_bleu(list(cs_hyps), list(cs_refs))
            clinspen_corpus = CorpusMetrics(bleu_score=cs_score, bleu_signature=cs_sig)
        except Exception as exc:
            logger.error("Job %s ClinSpEn corpus BLEU failed: %s", job_id, exc)

    umass_pairs = [
        (row.llm_english_translation, row.english_reference)
        for _, row in successfully_translated
        if row.source == "UMass_EHR"
    ]
    if umass_pairs:
        try:
            um_hyps, um_refs = zip(*umass_pairs)
            um_score, um_sig = compute_corpus_bleu(list(um_hyps), list(um_refs))
            umass_corpus = CorpusMetrics(bleu_score=um_score, bleu_signature=um_sig)
        except Exception as exc:
            logger.error("Job %s UMass corpus BLEU failed: %s", job_id, exc)

    job.corpus_metrics = DatasetCorpusMetrics(
        overall=overall_corpus,
        clinspen=clinspen_corpus,
        umass=umass_corpus,
    )

    # ------------------------------------------------------------------
    # Phase 6: Record library versions
    # ------------------------------------------------------------------
    try:
        versions = get_library_versions()
        job.library_versions = LibraryVersions(**versions)
    except Exception as exc:
        logger.error("Job %s version capture failed: %s", job_id, exc)

    job.status = JobStatus.complete
    logger.info("Job %s: complete", job_id)
