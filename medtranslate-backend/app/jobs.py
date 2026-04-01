"""Job store (SQLite-backed with in-memory cache) and background job execution."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.config import DATABASE_PATH
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

IDLE_TIMEOUT_SECONDS = int(os.getenv("JOB_IDLE_TIMEOUT", "300"))


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
    last_poll_at: float = field(default_factory=time.time)
    bertscore_completed: int = 0
    bertscore_total: int = 0


# ---------------------------------------------------------------------------
# In-memory cache (hot path) + SQLite persistence (survives restarts)
# ---------------------------------------------------------------------------

_jobs: dict[str, Job] = {}
_MAX_CACHED_JOBS = int(os.getenv("MAX_CACHED_JOBS", "50"))

# Tracks which job IDs this instance is actively executing, so we know
# to trust the in-memory state rather than reading back from SQLite.
_executing: set[str] = set()

# Guards concurrent writes from the asyncio thread pool
_write_lock = threading.Lock()

# Set to True once the schema has been created
_db_ready = False


def _evict_oldest_terminal_jobs() -> None:
    """Evict the oldest terminal-state jobs from the in-memory cache when
    it exceeds _MAX_CACHED_JOBS entries. Skips jobs that are actively executing."""
    if len(_jobs) <= _MAX_CACHED_JOBS:
        return
    terminal = {JobStatus.complete, JobStatus.failed, JobStatus.cancelled}
    to_evict = [
        jid for jid, j in _jobs.items()
        if j.status in terminal and jid not in _executing
    ]
    # Evict until we're under the limit
    for jid in to_evict:
        if len(_jobs) <= _MAX_CACHED_JOBS:
            break
        del _jobs[jid]
        logger.debug("Evicted job %s from in-memory cache", jid)


def _ensure_db() -> bool:
    """Create the jobs table if it doesn't exist. Returns False when the DB
    path is not writable (e.g. Render Disk not mounted), disabling persistence
    gracefully instead of crashing."""
    global _db_ready
    if _db_ready:
        return True
    try:
        db_dir = os.path.dirname(DATABASE_PATH)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        with sqlite3.connect(DATABASE_PATH) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS jobs "
                "(job_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', "
                "cancelled INTEGER DEFAULT 0, created_at REAL, data TEXT NOT NULL)"
            )
            # Migration: add columns if upgrading from older schema
            for col, definition in [
                ("cancelled", "INTEGER DEFAULT 0"),
                ("created_at", "REAL"),
                ("status", "TEXT NOT NULL DEFAULT 'queued'"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE jobs ADD COLUMN {col} {definition}")
                except sqlite3.OperationalError:
                    pass  # column already exists

            # Translation cache table: avoids redundant LLM calls for
            # identical inputs across jobs and re-runs.
            conn.execute(
                "CREATE TABLE IF NOT EXISTS translation_cache "
                "(cache_key TEXT PRIMARY KEY, translation TEXT NOT NULL, created_at REAL)"
            )
        _db_ready = True
        logger.info("SQLite job store ready at %s", DATABASE_PATH)
        return True
    except Exception as exc:
        logger.warning(
            "SQLite unavailable at %s (%s) — job results will not survive restarts",
            DATABASE_PATH,
            exc,
        )
        return False


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _job_to_dict(job: Job, *, include_rows: bool = True) -> dict:
    d: dict = {
        "job_id": job.job_id,
        "status": job.status.value,
        "model_config": job.model_config.model_dump(),
        "translated": job.translated,
        "scored": job.scored,
        "failed_rows": job.failed_rows,
        "sentence_metrics": [m.model_dump() for m in job.sentence_metrics],
        "corpus_metrics": job.corpus_metrics.model_dump() if job.corpus_metrics else None,
        "library_versions": job.library_versions.model_dump() if job.library_versions else None,
        "error": job.error,
        "cancelled": job.cancelled,
        "bertscore_completed": job.bertscore_completed,
        "bertscore_total": job.bertscore_total,
    }
    if include_rows:
        d["rows"] = [
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
        ]
    else:
        d["rows"] = []
    return d


def _job_from_dict(data: dict) -> Job:
    return Job(
        job_id=data["job_id"],
        status=JobStatus(data["status"]),
        rows=[InputRow(**r) for r in data.get("rows", [])],
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
        bertscore_completed=data.get("bertscore_completed", 0),
        bertscore_total=data.get("bertscore_total", 0),
    )


# ---------------------------------------------------------------------------
# Blocking SQLite helpers (called via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _db_save(job: Job) -> None:
    """Upsert a job into SQLite. No-op when the DB is unavailable."""
    if not _ensure_db():
        return
    # At terminal states, omit rows[] to halve the blob size —
    # sentence_metrics already contains everything the frontend needs.
    is_terminal = job.status in (JobStatus.complete, JobStatus.failed, JobStatus.cancelled)
    payload = json.dumps(_job_to_dict(job, include_rows=not is_terminal))
    with _write_lock:
        try:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO jobs (job_id, status, cancelled, created_at, data) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (job.job_id, job.status.value, int(job.cancelled), time.time(), payload),
                )
        except Exception as exc:
            logger.warning("SQLite write failed for job %s: %s", job.job_id, exc)


def _db_save_status(job: Job) -> None:
    """Persist job state at chunk boundaries. Serializes the full state
    (minus the heavy rows array) so that non-executing instances can
    serve accurate progress via their SQLite read path."""
    if not _ensure_db():
        return
    payload = json.dumps(_job_to_dict(job, include_rows=False))
    with _write_lock:
        try:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO jobs (job_id, status, cancelled, created_at, data) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (job.job_id, job.status.value, int(job.cancelled), time.time(), payload),
                )
        except Exception as exc:
            logger.warning("SQLite status write failed for job %s: %s", job.job_id, exc)


def _db_load(job_id: str) -> Optional[dict]:
    """Fetch a job's JSON payload from SQLite. Returns None on miss or error."""
    if not _ensure_db():
        return None
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            row = conn.execute(
                "SELECT data FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
        return json.loads(row[0]) if row else None
    except Exception as exc:
        logger.warning("SQLite read failed for job %s: %s", job_id, exc)
        return None


def _db_load_cancelled(job_id: str) -> Optional[bool]:
    """Read only the cancelled flag from the dedicated SQLite column.
    Avoids deserializing the entire multi-MB JSON blob for a boolean check."""
    if not _ensure_db():
        return None
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            row = conn.execute(
                "SELECT cancelled FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
        if row is None:
            return None
        return bool(row[0])
    except Exception:
        return None


def _db_set_cancelled(job_id: str) -> None:
    """Set the cancelled flag directly in the dedicated column."""
    if not _ensure_db():
        return
    try:
        with _write_lock:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.execute(
                    "UPDATE jobs SET cancelled = 1 WHERE job_id = ?", (job_id,)
                )
    except Exception as exc:
        logger.warning("SQLite cancel flag write failed for job %s: %s", job_id, exc)


def _db_cleanup_old_jobs(days: int = 7) -> int:
    """Delete terminal-state jobs older than `days` days. Returns count deleted."""
    if not _ensure_db():
        return 0
    cutoff = time.time() - (days * 86400)
    try:
        with _write_lock:
            with sqlite3.connect(DATABASE_PATH) as conn:
                cursor = conn.execute(
                    "DELETE FROM jobs WHERE created_at IS NOT NULL AND created_at < ? "
                    "AND status IN ('complete', 'failed', 'cancelled')",
                    (cutoff,),
                )
                deleted = cursor.rowcount
        if deleted:
            logger.info("TTL cleanup: deleted %d jobs older than %d days", deleted, days)
        return deleted
    except Exception as exc:
        logger.warning("TTL cleanup failed: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Translation cache helpers
# ---------------------------------------------------------------------------

def _cache_key(model: str, system_prompt: str, temperature: float, source_text: str) -> str:
    """Build a deterministic cache key from the translation parameters."""
    raw = f"{model}|{system_prompt}|{temperature}|{source_text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]


def _cache_get(key: str) -> Optional[str]:
    """Look up a cached translation. Returns None on miss or error."""
    if not _ensure_db():
        return None
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            row = conn.execute(
                "SELECT translation FROM translation_cache WHERE cache_key = ?",
                (key,),
            ).fetchone()
        return row[0] if row else None
    except Exception:
        return None


def _cache_set(key: str, translation: str, temperature: float) -> None:
    """Store a translation in the cache. Only caches deterministic (temperature=0) outputs."""
    if temperature != 0.0:
        return
    if not _ensure_db():
        return
    try:
        with _write_lock:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO translation_cache (cache_key, translation, created_at) "
                    "VALUES (?, ?, ?)",
                    (key, translation, time.time()),
                )
    except Exception:
        pass  # cache write failure is non-critical


# ---------------------------------------------------------------------------
# Async persistence helpers
# ---------------------------------------------------------------------------

async def _persist(job: Job) -> None:
    """Write job state to SQLite without blocking the event loop."""
    await asyncio.to_thread(_db_save, job)


async def _fetch_from_db(job_id: str) -> Optional[Job]:
    """Load a job from SQLite. Returns None on miss.

    Returns the job in whatever state it was last persisted. This allows
    multi-instance deployments (e.g. Render with 2+ instances) to read
    job status written by a different instance without incorrectly marking
    in-progress jobs as failed. The execute_job try/except handles real
    failures by explicitly setting status to 'failed' with a meaningful
    error message.
    """
    data = await asyncio.to_thread(_db_load, job_id)
    if data is None:
        return None
    return _job_from_dict(data)


async def _check_cancelled_from_db(job_id: str) -> bool:
    """Check whether a job has been cancelled in SQLite. Used by the
    executing instance to pick up cancellation requests made by a
    different instance."""
    result = await asyncio.to_thread(_db_load_cancelled, job_id)
    return result is True


async def _get_job(job_id: str) -> Optional[Job]:
    """Return the most up-to-date job state.

    If this instance is actively executing the job, the in-memory state
    is authoritative (it has live progress counts, partial results, etc.).

    If this instance is NOT executing the job (i.e. it is a second Render
    instance handling a poll request), always read from SQLite to get the
    latest progress written by the executing instance.

    For jobs in a terminal state (complete, failed, cancelled), serve from
    the in-memory cache if available to avoid unnecessary SQLite reads.
    """
    # This instance is running the job: in-memory state is authoritative
    if job_id in _executing:
        return _jobs.get(job_id)

    # Check in-memory cache for terminal states (fast path)
    job = _jobs.get(job_id)
    if job is not None and job.status not in (JobStatus.queued, JobStatus.running):
        return job

    # For in-progress or unknown jobs, always read latest from SQLite
    refreshed = await _fetch_from_db(job_id)
    if refreshed is not None:
        _jobs[job_id] = refreshed  # update cache
        return refreshed

    return job


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
    """Cancel a running job. Returns True if the job was found and cancelled.

    Persists the cancelled flag to SQLite so that the executing instance
    (which may be a different Render instance) picks it up on its next
    chunk boundary check.
    """
    job = await _get_job(job_id)
    if job is None:
        return False
    job.cancelled = True
    if job.status in (JobStatus.queued, JobStatus.running):
        job.status = JobStatus.cancelled
        logger.info("Job %s: cancelled by user", job_id)
    _jobs[job_id] = job
    # Fast-path: update the dedicated cancelled column directly
    await asyncio.to_thread(_db_set_cancelled, job_id)
    await _persist(job)
    return True


async def get_job(job_id: str) -> Optional[Job]:
    return await _get_job(job_id)


async def get_job_status(job_id: str) -> Optional[JobStatusResponse]:
    job = await _get_job(job_id)
    if job is None:
        return None
    # Update last_poll_at so the idle timeout knows the client is still connected
    job.last_poll_at = time.time()
    # Use rows length if available; fall back to sentence_metrics length for
    # terminal jobs loaded from SQLite where rows were omitted to save space.
    total = len(job.rows) if job.rows else len(job.sentence_metrics)
    return JobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        total=total,
        translated=job.translated,
        scored=job.scored,
        failed_rows=job.failed_rows,
        error=job.error,
        bertscore_completed=job.bertscore_completed,
        bertscore_total=job.bertscore_total,
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

    _executing.add(job_id)

    try:
        job.status = JobStatus.running
        await _persist(job)  # record running state
        total = len(job.rows)
        logger.info("Job %s: starting (%d rows)", job_id, total)

        system_prompt = job.model_config.system_prompt or ""
        model = job.model_config.model
        # Force deterministic translations for reproducible SacreBLEU runs.
        # We keep this server-side so API callers cannot accidentally override it.
        temperature = 0.0
        max_tokens = job.model_config.max_tokens
        compute_bertscore = getattr(job.model_config, "compute_bertscore", False)
        metrics_only = getattr(job.model_config, "metrics_only", False)

        # Tunable concurrency controls
        MAX_CONCURRENT_TRANSLATIONS = int(
            os.getenv("MAX_CONCURRENT_TRANSLATIONS", "4")
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
            # --- Deduplication pre-pass: translate each unique source text once ---
            unique_texts: dict[str, str | None] = {}  # source_text -> translation (None = not yet translated)
            for row in job.rows:
                text_key = row.source_text or row.spanish_source
                if text_key and text_key not in unique_texts:
                    unique_texts[text_key] = None

            # Check translation cache for unique texts (warm up from previous runs)
            cache_hits = 0
            for text_key in list(unique_texts.keys()):
                try:
                    ck = _cache_key(model, system_prompt, temperature, text_key)
                    cached = await asyncio.to_thread(_cache_get, ck)
                    if cached is not None:
                        unique_texts[text_key] = cached
                        cache_hits += 1
                except Exception:
                    pass  # cache miss is fine
            if cache_hits:
                logger.info("Job %s: translation cache hit for %d unique texts", job_id, cache_hits)

            # Build list of unique texts that still need translation
            texts_to_translate = [t for t, v in unique_texts.items() if v is None]
            dedup_savings = total - len(texts_to_translate) - cache_hits
            if dedup_savings > 0 or cache_hits > 0:
                logger.info(
                    "Job %s: %d cache hits, %d dedup savings (%d texts need API calls of %d total)",
                    job_id, cache_hits, max(0, dedup_savings), len(texts_to_translate), total,
                )

            # Translate unique texts in chunks
            async def _translate_unique(idx: int, text: str):
                async with semaphore:
                    try:
                        translation = await translate_text(
                            text,
                            model=model,
                            system_prompt=system_prompt,
                            temperature=temperature,
                            max_tokens=max_tokens,
                        )
                        # Write to cache (only for deterministic temperature=0)
                        try:
                            ck = _cache_key(model, system_prompt, temperature, text)
                            await asyncio.to_thread(_cache_set, ck, translation, temperature)
                        except Exception:
                            pass  # cache write failure is non-critical
                        return idx, text, translation, None
                    except Exception as exc:
                        return idx, text, "", str(exc)

            unique_total = len(texts_to_translate)
            for start in range(0, unique_total, CHUNK_SIZE):
                # Check for cancellation (local + cross-instance)
                if job.cancelled or await _check_cancelled_from_db(job_id):
                    job.cancelled = True
                    logger.info("Job %s: cancelled during translation phase", job_id)
                    break

                # Server-side idle timeout: cancel if no client poll for too long
                if time.time() - job.last_poll_at > IDLE_TIMEOUT_SECONDS:
                    job.cancelled = True
                    logger.info("Job %s: auto-cancelled due to idle timeout (%ds)", job_id, IDLE_TIMEOUT_SECONDS)
                    break

                end = min(start + CHUNK_SIZE, unique_total)
                tasks = [
                    asyncio.create_task(_translate_unique(i, texts_to_translate[i]))
                    for i in range(start, end)
                ]

                results = await asyncio.gather(*tasks)

                for _idx, src_text, translation, error in sorted(results, key=lambda x: x[0]):
                    if error is None:
                        unique_texts[src_text] = translation
                    else:
                        unique_texts[src_text] = None
                        logger.error("Job %s unique text translation failed: %s", job_id, error)

                # Fan results back to all rows sharing each translated text
                for i, row in enumerate(job.rows):
                    text_key = row.source_text or row.spanish_source
                    cached = unique_texts.get(text_key)
                    if cached is not None and not row.llm_english_translation:
                        row.llm_english_translation = cached
                        job.translated = sum(1 for r in job.rows if r.llm_english_translation)
                        job.sentence_metrics[i] = _make_sentence_metrics(
                            row, llm_english_translation=cached,
                        )
                    elif cached is None and text_key and unique_texts.get(text_key) is None:
                        # Check if this text was attempted but failed
                        pass

                # Count failures: rows whose unique text was attempted but got None
                job.failed_rows = sum(
                    1 for row in job.rows
                    if not row.llm_english_translation and unique_texts.get(row.source_text or row.spanish_source) is None
                    and (row.source_text or row.spanish_source) in unique_texts
                )

                # Lightweight persist: only status/progress, not the full blob
                await asyncio.to_thread(_db_save_status, job)
                await asyncio.sleep(0)

            # Final fan-out: ensure all rows with successful translations are populated
            for i, row in enumerate(job.rows):
                text_key = row.source_text or row.spanish_source
                cached = unique_texts.get(text_key)
                if cached is not None:
                    row.llm_english_translation = cached
                    job.sentence_metrics[i] = _make_sentence_metrics(
                        row, llm_english_translation=cached,
                    )
                elif text_key:
                    # Translation failed for this unique text
                    job.sentence_metrics[i] = _make_sentence_metrics(
                        row, llm_english_translation="", error="Translation failed",
                    )

            job.translated = sum(1 for r in job.rows if r.llm_english_translation)
            job.failed_rows = sum(
                1 for r in job.rows
                if not r.llm_english_translation and (r.source_text or r.spanish_source)
            )

        # If cancelled, finalize status and return early with partial results
        if job.cancelled:
            job.status = JobStatus.cancelled
            logger.info("Job %s: stopped after %d translations", job_id, job.translated)
            await _persist(job)
            _evict_oldest_terminal_jobs()
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
        await asyncio.to_thread(_db_save_status, job)

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

        # Compute per-source BLEU for all corpora present in the uploaded dataset.
        by_source: dict[str, CorpusMetrics] = {}
        pairs_by_source: dict[str, list[tuple[str, str]]] = {}
        for _, row in successfully_translated:
            pairs_by_source.setdefault(row.source, []).append(
                (row.llm_english_translation, row.english_reference)
            )

        for source_name, source_pairs in pairs_by_source.items():
            if not source_pairs:
                continue
            try:
                src_hyps, src_refs = zip(*source_pairs)
                src_score, src_sig = compute_corpus_bleu(list(src_hyps), list(src_refs))
                by_source[source_name] = CorpusMetrics(
                    bleu_score=src_score,
                    bleu_signature=src_sig,
                )
            except Exception as exc:
                logger.error("Job %s source BLEU failed for %s: %s", job_id, source_name, exc)

        clinspen_corpus = by_source.get("ClinSpEn_ClinicalCases")
        umass_corpus = by_source.get("UMass_EHR")

        job.corpus_metrics = DatasetCorpusMetrics(
            overall=overall_corpus,
            by_source=by_source,
            clinspen=clinspen_corpus,
            umass=umass_corpus,
        )

        # Persist post-BLEU state so non-executing instances return stable progress.
        await asyncio.to_thread(_db_save_status, job)

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

            job.bertscore_total = len(candidates_for_bert)
            job.bertscore_completed = 0
            await asyncio.to_thread(_db_save_status, job)

            def _on_bert_progress(completed: int, total_count: int) -> None:
                job.bertscore_completed = completed
                job.bertscore_total = total_count
                # Persist so polling requests handled by other instances report
                # real BERTScore progress instead of staying at 0.
                _db_save_status(job)

            try:
                bert_f1_scores = await asyncio.to_thread(
                    compute_bertscore_batch,
                    candidates_for_bert,
                    references_for_bert,
                    _on_bert_progress,
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
        _evict_oldest_terminal_jobs()
        logger.info("Job %s: complete", job_id)

    except Exception as exc:
        logger.error("Job %s: unhandled error in execute_job: %s", job_id, exc)
        job.status = JobStatus.failed
        job.error = f"Job execution failed: {exc}"
        await _persist(job)
        _evict_oldest_terminal_jobs()

    finally:
        _executing.discard(job_id)
