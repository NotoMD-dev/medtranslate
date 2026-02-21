"""In-memory job store and background job execution logic."""

from __future__ import annotations
import os
import asyncio
import logging
import time
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

    translated: int = 0
    scored: int = 0
    failed_rows: int = 0

    sentence_metrics: list[SentenceMetrics] = field(default_factory=list)
    corpus_metrics: Optional[DatasetCorpusMetrics] = None
    library_versions: Optional[LibraryVersions] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

_jobs: dict[str, Job] = {}

# ---------------------------------------------------------------------------
# Global rate limiter (token-bucket) — limits requests/second across all jobs
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Async token-bucket rate limiter."""

    def __init__(self, rate: float):
        self._rate = rate  # tokens (requests) per second
        self._tokens = rate
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
            self._last = now

            if self._tokens < 1.0:
                wait = (1.0 - self._tokens) / self._rate
                await asyncio.sleep(wait)
                self._tokens = 0.0
                self._last = time.monotonic()
            else:
                self._tokens -= 1.0


_GLOBAL_RATE = float(os.getenv("TRANSLATE_REQUESTS_PER_SECOND", "3"))
_rate_limiter = _RateLimiter(_GLOBAL_RATE)

# Only one job executes at a time to avoid compounding rate-limit pressure.
_job_lock = asyncio.Lock()


def create_job(rows: list[InputRow], config: ModelConfig) -> str:
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
        translation_config=job.model_config,
    )


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------

async def execute_job(job_id: str) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return

    # Wait for any other running job to finish before starting.
    async with _job_lock:
        await _execute_job_inner(job_id, job)


async def _execute_job_inner(job_id: str, job: Job) -> None:
    job.status = JobStatus.running
    total = len(job.rows)
    logger.info("Job %s: starting (%d rows)", job_id, total)

    system_prompt = job.model_config.system_prompt or ""
    model = job.model_config.model
    temperature = job.model_config.temperature
    max_tokens = job.model_config.max_tokens
    compute_bertscore = getattr(job.model_config, "compute_bertscore", False)

    # Tunable concurrency controls
    MAX_CONCURRENT_TRANSLATIONS = int(
        os.getenv("MAX_CONCURRENT_TRANSLATIONS", "3")
    )
    CHUNK_SIZE = int(
        os.getenv("TRANSLATION_CHUNK_SIZE", "50")
    )
    INTER_CHUNK_DELAY = float(
        os.getenv("TRANSLATION_INTER_CHUNK_DELAY", "1.0")
    )
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRANSLATIONS)

    async def _translate_one(index: int, row: InputRow):
        await _rate_limiter.acquire()
        async with semaphore:
            try:
                translation = await translate_text(
                    row.spanish_source,
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
        SentenceMetrics(
            pair_id=row.pair_id,
            source=row.source,
            content_type=row.content_type,
            spanish_source=row.spanish_source,
            english_reference=row.english_reference,
            llm_english_translation="",
        )
        for row in job.rows
    ]

    # ------------------------------------------------------------------
    # Phase 1: Concurrent translation (chunked)
    # Sentence metrics are updated incrementally as translations complete.
    # ------------------------------------------------------------------
    for start in range(0, total, CHUNK_SIZE):
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
                # Update sentence_metrics in-place for real-time display
                job.sentence_metrics[index] = SentenceMetrics(
                    pair_id=row.pair_id,
                    source=row.source,
                    content_type=row.content_type,
                    spanish_source=row.spanish_source,
                    english_reference=row.english_reference,
                    llm_english_translation=translation,
                )
            else:
                logger.error("Job %s row %d translation failed: %s", job_id, index, error)
                row.llm_english_translation = ""
                job.failed_rows += 1
                job.sentence_metrics[index] = SentenceMetrics(
                    pair_id=row.pair_id,
                    source=row.source,
                    content_type=row.content_type,
                    spanish_source=row.spanish_source,
                    english_reference=row.english_reference,
                    llm_english_translation="",
                    error=error,
                )

        # Pause between chunks to avoid rate-limit pressure
        if end < total:
            await asyncio.sleep(INTER_CHUNK_DELAY)

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
        job.sentence_metrics[i] = SentenceMetrics(
            pair_id=row.pair_id,
            source=row.source,
            content_type=row.content_type,
            spanish_source=row.spanish_source,
            english_reference=row.english_reference,
            llm_english_translation=row.llm_english_translation,
            meteor=meteor_val,
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
    logger.info("Job %s: complete", job_id)
