"""Job store (Redis-backed with in-memory cache) and background job execution."""

from __future__ import annotations

import json
import os
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from app.config import JOB_TTL_SECONDS, REDIS_URL
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
    source_text: str
    english_reference: str
    spanish_source: str = ""  # backward compat
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

    translated: int = 0
    scored: int = 0
    failed_rows: int = 0

    sentence_metrics: list[SentenceMetrics] = field(default_factory=list)
    corpus_metrics: Optional[DatasetCorpusMetrics] = None
    library_versions: Optional[LibraryVersions] = None
    error: Optional[str] = None
    cancelled: bool = False


# ---------------------------------------------------------------------------
# In-memory cache (hot path) + Redis persistence (survives restarts)
# ---------------------------------------------------------------------------

_jobs: dict[str, Job] = {}
_redis_client: Any = None


def _get_redis_client() -> Any:
    """Lazily create a Redis client. Returns None when REDIS_URL is not set."""
    global _redis_client
    if not REDIS_URL:
        return None
    if _redis_client is None:
        try:
            import redis.asyncio as aioredis  # type: ignore[import]
            _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
        except Exception as exc:  # pragma: no cover
            logger.warning("Could not create Redis client: %s", exc)
            return None
    return _redis_client


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _job_to_dict(job: Job) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "rows": [
            {
                "pair_id": r.pair_id,
                "source": r.source,
                "content_type": r.content_type,
                "source_text": r.source_text,
                "english_reference": r.english_reference,
                "spanish_source": r.spanish_source,
                "llm_english_translation": r.llm_english_translation,
            }
            for r in job.rows
        ],
        "model_config": job.model_config.model_dump(),
        "translated": job.translated,
        "scored": job.scored,
        "failed_rows": job.failed_rows,
        "sentence_metrics": [m.model_dump() for m in job.sentence_metrics],
        "corpus_metrics": job.corpus_metrics.model_dump() if job.corpus_metrics else None,
        "library_versions": job.library_versions.model_dump() if job.library_versions else None,
        "error": job.error,
        "cancelled": job.cancelled,
    }


def _job_from_dict(data: dict) -> Job:
    return Job(
        job_id=data["job_id"],
        status=JobStatus(data["status"]),
        rows=[InputRow(**r) for r in data["rows"]],
        model_config=ModelConfig.model_validate(data["model_config"]),
        translated=data.get("translated", 0),
        scored=data.get("scored", 0),
        failed_rows=data.get("failed_rows", 0),
        sentence_metrics=[
            SentenceMetrics.model_validate(m) for m in data.get("sentence_metrics", [])
        ],
        corpus_metrics=(
            DatasetCorpusMetrics.model_validate(data["corpus_metrics"])
            if data.get("corpus_metrics")
            else None
        ),
        library_versions=(
            LibraryVersions.model_validate(data["library_versions"])
            if data.get("library_versions")
            else None
        ),
        error=data.get("error"),
        cancelled=data.get("cancelled", False),
    )


# ---------------------------------------------------------------------------
# Redis I/O helpers
# ---------------------------------------------------------------------------

async def _persist(job: Job) -> None:
    """Write job state to Redis. No-op when Redis is not configured."""
    client = _get_redis_client()
    if client is None:
        return
    try:
        await client.setex(
            f"job:{job.job_id}",
            JOB_TTL_SECONDS,
            json.dumps(_job_to_dict(job)),
        )
    except Exception as exc:
        logger.warning("Redis write failed for job %s: %s", job.job_id, exc)


async def _fetch_from_redis(job_id: str) -> Optional[Job]:
    """Load a job from Redis. Returns None on miss or error."""
    client = _get_redis_client()
    if client is None:
        return None
    try:
        data = await client.get(f"job:{job_id}")
        if data is None:
            return None
        job = _job_from_dict(json.loads(data))
        # A job that was queued/running when the server died can never complete —
        # mark it failed so clients get a useful status instead of hanging forever.
        if job.status in (JobStatus.queued, JobStatus.running):
            job.status = JobStatus.failed
            job.error = job.error or "Job was interrupted by a server restart."
            await _persist(job)
        _jobs[job_id] = job  # warm the in-memory cache
        return job
    except Exception as exc:
        logger.warning("Redis read failed for job %s: %s", job_id, exc)
        return None


async def _get_job(job_id: str) -> Optional[Job]:
    """Return a job from the in-memory cache, falling back to Redis."""
    job = _jobs.get(job_id)
    if job is not None:
        return job
    return await _fetch_from_redis(job_id)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def create_job(rows: list[InputRow], config: ModelConfig) -> str:
    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id, rows=rows, model_config=config)
    _jobs[job_id] = job
    await _persist(job)
    return job_id


async def cancel_job(job_id: str) -> bool:
    """Cancel a running job. Returns True if the job was found and cancelled."""
    job = await _get_job(job_id)
    if job is None:
        return False
    job.cancelled = True
    if job.status in (JobStatus.queued, JobStatus.running):
        job.status = JobStatus.cancelled
        logger.info("Job %s: cancelled by user", job_id)
    await _persist(job)
    return True


async def get_job(job_id: str) -> Optional[Job]:
    return await _get_job(job_id)


async def get_job_status(job_id: str) -> Optional[JobStatusResponse]:
    job = await _get_job(job_id)
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


async def get_job_results(job_id: str, *, offset: int = 0, limit: int = 0) -> Optional[JobResults]:
    job = await _get_job(job_id)
    if job is None:
        return None
    total = len(job.sentence_metrics)
    metrics = job.sentence_metrics
    if limit > 0:
        metrics = job.sentence_metrics[offset:offset + limit]
    elif offset > 0:
        metrics = job.sentence_metrics[offset:]
    return JobResults(
        job_id=job.job_id,
        status=job.status,
        corpus_metrics=job.corpus_metrics,
        sentence_metrics=metrics,
        library_versions=job.library_versions,
        translation_config=job.model_config,
        total=total,
        offset=offset,
    )


def _make_sentence_metrics(row: InputRow, **overrides) -> SentenceMetrics:
    """Helper to build a SentenceMetrics from an InputRow with optional overrides."""
    return SentenceMetrics(
        pair_id=row.pair_id,
        source=row.source,
        content_type=row.content_type,
        source_text=row.source_text,
        spanish_source=row.spanish_source or row.source_text,
        english_reference=row.english_reference,
        llm_english_translation=overrides.get("llm_english_translation", row.llm_english_translation),
        meteor=overrides.get("meteor", None),
        bertscore_f1=overrides.get("bertscore_f1", None),
        error=overrides.get("error", None),
    )


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------

async def execute_job(job_id: str) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return

    job.status = JobStatus.running
    await _persist(job)  # record running state so restart detection works
    total = len(job.rows)
    logger.info("Job %s: starting (%d rows)", job_id, total)

    system_prompt = job.model_config.system_prompt or ""
    model = job.model_config.model
    temperature = job.model_config.temperature
    max_tokens = job.model_config.max_tokens
    compute_bertscore = getattr(job.model_config, "compute_bertscore", False)
    metrics_only = getattr(job.model_config, "metrics_only", False)

    # Tunable concurrency controls
    MAX_CONCURRENT_TRANSLATIONS = int(
        os.getenv("MAX_CONCURRENT_TRANSLATIONS", "10")
    )
    CHUNK_SIZE = int(
        os.getenv("TRANSLATION_CHUNK_SIZE", "200")
    )
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRANSLATIONS)

    async def _translate_one(index: int, row: InputRow):
        async with semaphore:
            try:
                # Use source_text (the generalized column) for translation
                text_to_translate = row.source_text or row.spanish_source
                translation = await translate_text(
                    text_to_translate,
                    model=model,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return index, translation, None
            except Exception as exc:
                return index, "", str(exc)

    # Pre-populate sentence_metrics with all rows (pending state)
    # so the frontend can display the table immediately during polling.
    job.sentence_metrics = [
        _make_sentence_metrics(row, llm_english_translation=row.llm_english_translation if metrics_only else "")
        for row in job.rows
    ]

    # ------------------------------------------------------------------
    # Phase 1: Concurrent translation (chunked) — SKIP if metrics_only
    # ------------------------------------------------------------------
    if metrics_only:
        # In metrics-only mode, use existing translations from the CSV
        logger.info("Job %s: metrics-only mode, skipping translation", job_id)
        job.translated = sum(1 for r in job.rows if r.llm_english_translation)
    else:
        for start in range(0, total, CHUNK_SIZE):
            # Check for cancellation before starting each chunk
            if job.cancelled:
                logger.info("Job %s: cancelled during translation phase", job_id)
                break

            end = min(start + CHUNK_SIZE, total)
            tasks = [
                asyncio.create_task(_translate_one(i, job.rows[i]))
                for i in range(start, end)
            ]

            results = await asyncio.gather(*tasks)

            # Apply results deterministically
            for index, translation, error in sorted(results, key=lambda x: x[0]):
                row = job.rows[index]

                if error is None:
                    row.llm_english_translation = translation
                    job.translated += 1
                    job.sentence_metrics[index] = _make_sentence_metrics(
                        row, llm_english_translation=translation,
                    )
                else:
                    logger.error("Job %s row %d translation failed: %s", job_id, index, error)
                    row.llm_english_translation = ""
                    job.failed_rows += 1
                    job.sentence_metrics[index] = _make_sentence_metrics(
                        row, llm_english_translation="", error=error,
                    )

            await asyncio.sleep(0)

    # If cancelled, finalize status and return early with partial results
    if job.cancelled:
        job.status = JobStatus.cancelled
        logger.info("Job %s: stopped after %d translations", job_id, job.translated)
        await _persist(job)
        return

    # ------------------------------------------------------------------
    # Phase 2: METEOR (moved entirely off event loop)
    # ------------------------------------------------------------------
    logger.info("Job %s: computing sentence-level METEOR", job_id)

    successfully_translated: list[tuple[int, InputRow]] = [
        (i, row)
        for i, row in enumerate(job.rows)
        if row.llm_english_translation and row.english_reference
    ]

    def _meteor_pass(rows_subset):
        results = []
        for i, row in rows_subset:
            try:
                results.append(compute_meteor(row.llm_english_translation, row.english_reference))
            except Exception:
                results.append(None)
        return results

    meteor_scores = await asyncio.to_thread(_meteor_pass, successfully_translated)
    job.scored = len(meteor_scores)

    # Update sentence_metrics with METEOR scores
    for idx, (i, row) in enumerate(successfully_translated):
        meteor_val = meteor_scores[idx] if idx < len(meteor_scores) else None
        job.sentence_metrics[i] = _make_sentence_metrics(
            row, llm_english_translation=row.llm_english_translation, meteor=meteor_val,
        )

    # ------------------------------------------------------------------
    # Phase 3: Corpus BLEU (sacrebleu) — computed BEFORE optional BERTScore
    # ------------------------------------------------------------------
    logger.info("Job %s: computing corpus BLEU", job_id)

    all_hyps = [row.llm_english_translation for _, row in successfully_translated]
    all_refs = [row.english_reference for _, row in successfully_translated]

    try:
        overall_score, overall_sig = compute_corpus_bleu(all_hyps, all_refs)
        overall_corpus = CorpusMetrics(
            bleu_score=overall_score,
            bleu_signature=overall_sig,
        )
    except Exception as exc:
        logger.error("Job %s overall corpus BLEU failed: %s", job_id, exc)
        overall_corpus = CorpusMetrics(
            bleu_score=0.0,
            bleu_signature=f"error: {exc}",
        )

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
            clinspen_corpus = CorpusMetrics(cs_score, cs_sig)
        except Exception:
            pass

    umass_pairs = [
        (row.llm_english_translation, row.english_reference)
        for _, row in successfully_translated
        if row.source == "UMass_EHR"
    ]

    if umass_pairs:
        try:
            um_hyps, um_refs = zip(*umass_pairs)
            um_score, um_sig = compute_corpus_bleu(list(um_hyps), list(um_refs))
            umass_corpus = CorpusMetrics(um_score, um_sig)
        except Exception:
            pass

    job.corpus_metrics = DatasetCorpusMetrics(
        overall=overall_corpus,
        clinspen=clinspen_corpus,
        umass=umass_corpus,
    )

    # ------------------------------------------------------------------
    # Phase 4: BERTScore (optional — only if user toggled it on)
    # This is the expensive step (~400MB torch load).
    # ------------------------------------------------------------------
    if compute_bertscore:
        logger.info("Job %s: computing BERTScore (user opted in)", job_id)
        candidates_for_bert = [
            row.llm_english_translation for _, row in successfully_translated
        ]
        references_for_bert = [
            row.english_reference for _, row in successfully_translated
        ]

        try:
            bert_f1_scores = await asyncio.to_thread(
                compute_bertscore_batch,
                candidates_for_bert,
                references_for_bert,
            )
        except Exception as exc:
            logger.error("Job %s BERTScore batch failed: %s", job_id, exc)
            bert_f1_scores = [None] * len(candidates_for_bert)

        # Update sentence_metrics with BERTScore
        for idx, (i, row) in enumerate(successfully_translated):
            existing = job.sentence_metrics[i]
            bert_val = (
                float(bert_f1_scores[idx])
                if idx < len(bert_f1_scores) and bert_f1_scores[idx] is not None
                else None
            )
            job.sentence_metrics[i] = SentenceMetrics(
                pair_id=existing.pair_id,
                source=existing.source,
                content_type=existing.content_type,
                source_text=existing.source_text,
                spanish_source=existing.spanish_source,
                english_reference=existing.english_reference,
                llm_english_translation=existing.llm_english_translation,
                meteor=existing.meteor,
                bertscore_f1=bert_val,
            )
    else:
        logger.info("Job %s: skipping BERTScore (not requested)", job_id)

    # ------------------------------------------------------------------
    # Phase 5: Version capture
    # ------------------------------------------------------------------
    try:
        versions = get_library_versions()
        job.library_versions = LibraryVersions(**versions)
    except Exception as exc:
        logger.error("Job %s version capture failed: %s", job_id, exc)

    job.status = JobStatus.complete
    await _persist(job)  # persist final results to survive future restarts
    logger.info("Job %s: complete", job_id)
