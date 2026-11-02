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
    bertscore_model,
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
from app.output_checks import detect_format_warning
from app.translate import classify_error, effective_reasoning_effort, translate_text

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
    # Carried over on metrics-only re-scores so failed rows keep their status.
    error: str = ""
    error_kind: str = ""


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
    failed_rows: int = 0          # refused_rows + incomplete_rows
    refused_rows: int = 0         # model declined / empty reply (scored as 0)
    incomplete_rows: int = 0      # provider / config failure (unscored, retryable)
    excluded_rows: int = 0        # refusals a reviewer marked legitimate (unscored)
    # Current phase for the progress bar (see JobStatusResponse.phase)
    phase: str = "queued"
    # Last time a lightweight status write hit SQLite (throttle; not persisted)
    last_status_persist: float = 0.0

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
        with sqlite3.connect(DATABASE_PATH) as conn:
            # Per-sentence metric cache (METEOR, BERTScore) keyed on the
            # candidate/reference pair, so re-scores only compute new rows.
            conn.execute(
                "CREATE TABLE IF NOT EXISTS metric_cache "
                "(cache_key TEXT PRIMARY KEY, value REAL NOT NULL, created_at REAL)"
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
        "refused_rows": job.refused_rows,
        "incomplete_rows": job.incomplete_rows,
        "excluded_rows": job.excluded_rows,
        "phase": job.phase,
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
                "error": r.error,
                "error_kind": r.error_kind,
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
        refused_rows=data.get("refused_rows", 0),
        incomplete_rows=data.get("incomplete_rows", 0),
        excluded_rows=data.get("excluded_rows", 0),
        phase=data.get("phase", "queued"),
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


# Progress writes are throttled so per-row updates never turn into per-row
# multi-megabyte SQLite writes on large jobs.
_STATUS_PERSIST_INTERVAL = float(os.getenv("STATUS_PERSIST_INTERVAL", "2.0"))


def _db_save_status_throttled(job: Job, force: bool = False) -> None:
    """Blocking. Persist progress at most every _STATUS_PERSIST_INTERVAL seconds."""
    now = time.time()
    if not force and now - job.last_status_persist < _STATUS_PERSIST_INTERVAL:
        return
    job.last_status_persist = now
    _db_save_status(job)


async def _persist_status_throttled(job: Job, force: bool = False) -> None:
    now = time.time()
    if not force and now - job.last_status_persist < _STATUS_PERSIST_INTERVAL:
        return
    job.last_status_persist = now
    await asyncio.to_thread(_db_save_status, job)


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

def _cache_key(
    model: str,
    system_prompt: str,
    temperature: Optional[float],
    source_text: str,
    reasoning_effort: Optional[str] = None,
) -> str:
    """Build a deterministic cache key from the translation parameters.

    The reasoning/thinking effort is part of the key: the same model and
    prompt at a different effort is a different experiment, so a run at
    ``high`` must never be served translations produced at ``medium``.
    """
    raw = f"{model}|{system_prompt}|{temperature}|{reasoning_effort or ''}|{source_text}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]


def _cache_get_many(keys: list[str]) -> dict[str, str]:
    """Look up many cached translations in one connection. Missing keys are absent."""
    if not keys or not _ensure_db():
        return {}
    found: dict[str, str] = {}
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            for i in range(0, len(keys), 500):
                chunk = keys[i:i + 500]
                placeholders = ",".join("?" * len(chunk))
                for k, v in conn.execute(
                    f"SELECT cache_key, translation FROM translation_cache WHERE cache_key IN ({placeholders})",
                    chunk,
                ):
                    found[k] = v
    except Exception as exc:
        logger.warning("Translation cache read failed: %s", exc)
    return found


def _cache_set_many(items: list[tuple[str, str]]) -> None:
    """Store many translations in one transaction. Failures are non-critical."""
    if not items or not _ensure_db():
        return
    now = time.time()
    try:
        with _write_lock:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO translation_cache (cache_key, translation, created_at) "
                    "VALUES (?, ?, ?)",
                    [(k, v, now) for k, v in items],
                )
    except Exception as exc:
        logger.warning("Translation cache write failed: %s", exc)


# ---------------------------------------------------------------------------
# Metric cache helpers (METEOR / BERTScore per candidate-reference pair)
# ---------------------------------------------------------------------------

def _metric_key(metric: str, version: str, candidate: str, reference: str) -> str:
    raw = f"{metric}|{version}|{candidate}|{reference}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]


def _metric_cache_get_many(keys: list[str]) -> dict[str, float]:
    if not keys or not _ensure_db():
        return {}
    found: dict[str, float] = {}
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            for i in range(0, len(keys), 500):
                chunk = keys[i:i + 500]
                placeholders = ",".join("?" * len(chunk))
                for k, v in conn.execute(
                    f"SELECT cache_key, value FROM metric_cache WHERE cache_key IN ({placeholders})",
                    chunk,
                ):
                    found[k] = float(v)
    except Exception as exc:
        logger.warning("Metric cache read failed: %s", exc)
    return found


def _metric_cache_set_many(items: list[tuple[str, float]]) -> None:
    if not items or not _ensure_db():
        return
    now = time.time()
    try:
        with _write_lock:
            with sqlite3.connect(DATABASE_PATH) as conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO metric_cache (cache_key, value, created_at) VALUES (?, ?, ?)",
                    [(k, v, now) for k, v in items],
                )
    except Exception as exc:
        logger.warning("Metric cache write failed: %s", exc)


def _meteor_with_cache(
    rows_subset: list[tuple[int, InputRow]],
    on_progress=None,
    progress_every: int = 25,
    lang: str = "en",
) -> tuple[list[Optional[float]], int]:
    """Blocking. METEOR for each row, reading and filling the metric cache.

    Returns (scores, cache_hits). The key includes the NLTK version because
    tokenizer and WordNet changes alter scores, and the target language
    (except English, whose keys predate language support) because it picks
    the tokenizer, stemmer and synonym dictionary. *on_progress(batch)* is
    called every *progress_every* rows with a list of (row_index, score)
    pairs so the caller can show rows filling in as they are scored.
    """
    nltk_version = get_library_versions().get("nltk", "")
    version = nltk_version if lang == "en" else f"{nltk_version}|{lang}"
    keys = [
        _metric_key("meteor", version, row.llm_english_translation, row.english_reference)
        for _, row in rows_subset
    ]
    cached = _metric_cache_get_many(keys)
    scores: list[Optional[float]] = []
    fresh: list[tuple[str, float]] = []
    batch: list[tuple[int, Optional[float]]] = []
    for key, (i, row) in zip(keys, rows_subset):
        if key in cached:
            value: Optional[float] = cached[key]
        else:
            try:
                value = compute_meteor(row.llm_english_translation, row.english_reference, lang)
            except Exception:
                value = None
            if value is not None:
                fresh.append((key, value))
        scores.append(value)
        batch.append((i, value))
        if on_progress and len(batch) >= progress_every:
            on_progress(batch)
            batch = []
    if on_progress and batch:
        on_progress(batch)
    _metric_cache_set_many(fresh)
    return scores, len(cached)


def _bertscore_config(lang: str) -> str:
    """BERTScore configuration baked into the cache key (see bertscore_worker.py).
    The English value predates language support and is kept so existing
    cached scores stay valid."""
    if lang == "en":
        return "roberta-base|en|rescaled"
    return f"{bertscore_model(lang)}|{lang}"


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

    # Execution may have started on this instance while the read was in
    # flight. The live object is then authoritative: replacing it with the
    # (older) SQLite copy would freeze every later poll at stale progress
    # until the job finished (the "0% then 100%" symptom).
    if job_id in _executing:
        return _jobs.get(job_id)

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
        refused_rows=job.refused_rows,
        incomplete_rows=job.incomplete_rows,
        excluded_rows=job.excluded_rows,
        phase=job.phase,
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


def _update_failure_counts(job: Job) -> None:
    """Recount refused / incomplete / excluded rows from sentence_metrics."""
    refused = incomplete = excluded = 0
    for m in job.sentence_metrics:
        if m.error_kind == "refusal":
            refused += 1
        elif m.error_kind == "excluded":
            excluded += 1
        elif m.error:
            incomplete += 1
    job.refused_rows, job.incomplete_rows, job.excluded_rows = refused, incomplete, excluded
    job.failed_rows = refused + incomplete


def _make_sentence_metrics(row: InputRow, **overrides) -> SentenceMetrics:
    """Helper to build a SentenceMetrics from an InputRow with optional overrides.

    ``format_warning`` is derived from the translation unless given explicitly;
    the translation text itself is never altered.
    """
    translation = overrides.get("llm_english_translation", row.llm_english_translation)
    if "format_warning" in overrides:
        format_warning = overrides["format_warning"]
    else:
        format_warning = detect_format_warning(translation, row.source_text) if translation else None
    return SentenceMetrics(
        pair_id=row.pair_id,
        source=row.source,
        content_type=row.content_type,
        source_text=row.source_text,
        spanish_source=row.spanish_source or row.source_text,
        english_reference=row.english_reference,
        llm_english_translation=translation,
        meteor=overrides.get("meteor", None),
        bertscore_f1=overrides.get("bertscore_f1", None),
        error=overrides.get("error", None),
        error_kind=overrides.get("error_kind", None),
        format_warning=format_warning,
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
        job.phase = "translating"
        await _persist(job)  # record running state
        total = len(job.rows)
        logger.info("Job %s: starting (%d rows)", job_id, total)

        system_prompt = job.model_config.system_prompt or ""
        model = job.model_config.model
        temperature = job.model_config.temperature
        max_tokens = job.model_config.max_tokens
        compute_bertscore = getattr(job.model_config, "compute_bertscore", False)
        metrics_only = getattr(job.model_config, "metrics_only", False)
        # Translations and references are in the target language; it picks
        # the tokenizer, stemmer, synonym dictionary and BERTScore model.
        target_lang = getattr(job.model_config, "target_language", None) or "en"
        # Effort that translate_text() will actually apply for this model.
        # Recorded on the job (so results say how they were produced) and
        # folded into the translation-cache key.
        reasoning_effort = effective_reasoning_effort(model)
        if getattr(job.model_config, "reasoning_effort", None) != reasoning_effort:
            job.model_config.reasoning_effort = reasoning_effort

        # Tunable concurrency controls
        MAX_CONCURRENT_TRANSLATIONS = int(
            os.getenv("MAX_CONCURRENT_TRANSLATIONS", "4")
        )
        CHUNK_SIZE = int(
            os.getenv("TRANSLATION_CHUNK_SIZE", "50")
        )
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRANSLATIONS)

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
            # In metrics-only mode, use existing translations from the CSV.
            # Rows submitted with an error/error_kind (a previous run's
            # failures) keep that status so refusals are still scored as 0
            # and incomplete rows stay unscored.
            logger.info("Job %s: metrics-only mode, skipping translation", job_id)
            for i, row in enumerate(job.rows):
                if not row.llm_english_translation and row.error:
                    # "excluded" is set by a reviewer who judged a refusal
                    # legitimate; it is kept out of every score.
                    kind = row.error_kind if row.error_kind in ("refusal", "infrastructure", "excluded") else "infrastructure"
                    job.sentence_metrics[i] = _make_sentence_metrics(
                        row, llm_english_translation="", error=row.error, error_kind=kind,
                    )
            job.translated = sum(1 for r in job.rows if r.llm_english_translation)
            _update_failure_counts(job)
        else:
            # --- Deduplication pre-pass: translate each unique source text once ---
            unique_texts: dict[str, str | None] = {}  # source_text -> translation (None = not yet translated)
            # source_text -> (error message, "refusal" | "infrastructure")
            unique_errors: dict[str, tuple[str, str]] = {}
            for row in job.rows:
                text_key = row.source_text or row.spanish_source
                if text_key and text_key not in unique_texts:
                    unique_texts[text_key] = None

            # Check the translation cache for every unique text in one batch
            # (one connection, chunked IN queries) instead of one connection
            # per sentence.
            key_for_text = {
                t: _cache_key(model, system_prompt, temperature, t, reasoning_effort)
                for t in unique_texts
            }
            cached_map = await asyncio.to_thread(_cache_get_many, list(key_for_text.values()))
            cache_writes_ok = temperature is None or temperature == 0.0

            # Rows that share each unique text, so a finished translation can
            # be written to its rows the moment it arrives (the table and the
            # progress bar move per sentence, not per chunk).
            rows_by_text: dict[str, list[int]] = {}
            for i, row in enumerate(job.rows):
                tk = row.source_text or row.spanish_source
                if tk:
                    rows_by_text.setdefault(tk, []).append(i)

            def _apply_translation(text_key: str, translation: str) -> None:
                unique_texts[text_key] = translation
                for i in rows_by_text.get(text_key, ()):
                    row = job.rows[i]
                    if not row.llm_english_translation:
                        row.llm_english_translation = translation
                        job.sentence_metrics[i] = _make_sentence_metrics(
                            row, llm_english_translation=translation,
                        )
                        job.translated += 1

            def _apply_failure(text_key: str, msg: str, kind: str) -> None:
                unique_texts[text_key] = None
                unique_errors[text_key] = (msg, kind)
                for i in rows_by_text.get(text_key, ()):
                    row = job.rows[i]
                    if not row.llm_english_translation and not row.error:
                        row.error, row.error_kind = msg, kind
                        job.sentence_metrics[i] = _make_sentence_metrics(
                            row, llm_english_translation="", error=msg, error_kind=kind,
                        )
                        if kind == "refusal":
                            job.refused_rows += 1
                        else:
                            job.incomplete_rows += 1
                job.failed_rows = job.refused_rows + job.incomplete_rows

            cache_hits = 0
            for text_key, ck in key_for_text.items():
                hit = cached_map.get(ck)
                if hit is not None:
                    _apply_translation(text_key, hit)
                    cache_hits += 1
            if cache_hits:
                await _persist_status_throttled(job, force=True)
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
                        _apply_translation(text, translation)
                        await _persist_status_throttled(job)
                        return idx, text, translation, None, None
                    except Exception as exc:
                        kind = classify_error(exc)
                        _apply_failure(text, str(exc), kind)
                        await _persist_status_throttled(job)
                        return idx, text, "", str(exc), kind

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

                # Rows were updated as each translation arrived (see
                # _apply_translation); here only the cache write remains.
                new_cache_entries: list[tuple[str, str]] = [
                    (key_for_text[src_text], translation)
                    for _idx, src_text, translation, error, _kind in results
                    if error is None
                ]
                for _idx, src_text, _translation, error, kind in results:
                    if error is not None:
                        logger.error(
                            "Job %s unique text translation failed (%s): %s", job_id, kind, error
                        )

                # One cache write per chunk (not per sentence); only when
                # sampling is pinned (temperature 0) or the model takes none.
                if new_cache_entries and cache_writes_ok:
                    await asyncio.to_thread(_cache_set_many, new_cache_entries)

                await _persist_status_throttled(job, force=True)
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
                elif text_key in unique_errors:
                    # Translation failed for this unique text: keep the real
                    # message and its class so the row can be scored (refusal)
                    # or retried (infrastructure).
                    msg, kind = unique_errors[text_key]
                    row.error, row.error_kind = msg, kind
                    job.sentence_metrics[i] = _make_sentence_metrics(
                        row, llm_english_translation="", error=msg, error_kind=kind,
                    )
                elif text_key and job.cancelled:
                    # Never attempted because the job was stopped: leave pending.
                    pass
                elif text_key:
                    msg, kind = "Translation was not attempted", "infrastructure"
                    row.error, row.error_kind = msg, kind
                    job.sentence_metrics[i] = _make_sentence_metrics(
                        row, llm_english_translation="", error=msg, error_kind=kind,
                    )

            job.translated = sum(1 for r in job.rows if r.llm_english_translation)
            _update_failure_counts(job)

        # If cancelled, finalize status and return early with partial results
        if job.cancelled:
            job.status = JobStatus.cancelled
            job.phase = "cancelled"
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
        # Refusals are model behaviour and count against it: METEOR 0,
        # BERTScore 0, and an empty hypothesis in corpus BLEU. Infrastructure
        # failures stay unscored.
        refused: list[tuple[int, InputRow]] = [
            (i, row)
            for i, row in enumerate(job.rows)
            if job.sentence_metrics[i].error_kind == "refusal" and row.english_reference
        ]

        job.phase = "meteor"
        job.scored = 0
        await _persist_status_throttled(job, force=True)

        def _on_meteor_progress(batch: list[tuple[int, Optional[float]]]) -> None:
            # Runs on the worker thread: fill scored rows in as they finish
            # so the table and the progress bar move during scoring.
            for i, value in batch:
                job.sentence_metrics[i] = job.sentence_metrics[i].model_copy(update={"meteor": value})
            job.scored += len(batch)
            _db_save_status_throttled(job)

        meteor_scores, meteor_hits = await asyncio.to_thread(
            _meteor_with_cache, successfully_translated, _on_meteor_progress, 25, target_lang,
        )
        if meteor_hits:
            logger.info("Job %s: METEOR cache hits for %d of %d rows", job_id, meteor_hits, len(meteor_scores))
        job.scored = len(meteor_scores) + len(refused)
        await asyncio.to_thread(_db_save_status, job)

        # Update sentence_metrics with METEOR scores
        for idx, (i, row) in enumerate(successfully_translated):
            meteor_val = meteor_scores[idx] if idx < len(meteor_scores) else None
            job.sentence_metrics[i] = _make_sentence_metrics(
                row, llm_english_translation=row.llm_english_translation, meteor=meteor_val,
            )
        for i, row in refused:
            existing = job.sentence_metrics[i]
            job.sentence_metrics[i] = existing.model_copy(
                update={"meteor": 0.0, "bertscore_f1": 0.0 if compute_bertscore else None}
            )

        # ------------------------------------------------------------------
        # Phase 3: Corpus BLEU (sacrebleu) — computed BEFORE optional BERTScore
        # ------------------------------------------------------------------
        logger.info("Job %s: computing corpus BLEU", job_id)
        job.phase = "bleu"
        await _persist_status_throttled(job, force=True)

        all_hyps = [row.llm_english_translation for _, row in successfully_translated] + ["" for _ in refused]
        all_refs = [row.english_reference for _, row in successfully_translated] + [row.english_reference for _, row in refused]

        try:
            overall_score, overall_sig = compute_corpus_bleu(all_hyps, all_refs, target_lang)
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

        by_source: dict[str, CorpusMetrics] = {}
        grouped_pairs: dict[str, list[tuple[str, str]]] = {}
        for _, row in successfully_translated:
            source_key = row.source or "Unknown"
            grouped_pairs.setdefault(source_key, []).append(
                (row.llm_english_translation, row.english_reference)
            )
        for _, row in refused:
            grouped_pairs.setdefault(row.source or "Unknown", []).append(("", row.english_reference))

        for source_key, pairs in grouped_pairs.items():
            try:
                hyps, refs = zip(*pairs)
                src_score, src_sig = compute_corpus_bleu(list(hyps), list(refs), target_lang)
                by_source[source_key] = CorpusMetrics(
                    bleu_score=src_score,
                    bleu_signature=src_sig,
                )
            except Exception as exc:
                logger.warning(
                    "Job %s source-level BLEU failed for %s: %s",
                    job_id,
                    source_key,
                    exc,
                )

        job.corpus_metrics = DatasetCorpusMetrics(
            overall=overall_corpus,
            by_source=by_source,
            clinspen=by_source.get("ClinSpEn_ClinicalCases"),
            umass=by_source.get("UMass_EHR"),
        )

        # Persist post-BLEU state so non-executing instances return stable progress.
        await asyncio.to_thread(_db_save_status, job)

        # ------------------------------------------------------------------
        # Phase 4: BERTScore (optional — only if user toggled it on)
        # This is the expensive step (~400MB torch load).
        # ------------------------------------------------------------------
        if compute_bertscore:
            logger.info("Job %s: computing BERTScore (user opted in)", job_id)
            # Only rows without a cached score go to the (expensive) model.
            bert_keys = [
                _metric_key("bertscore", _bertscore_config(target_lang), row.llm_english_translation, row.english_reference)
                for _, row in successfully_translated
            ]
            bert_cached = await asyncio.to_thread(_metric_cache_get_many, bert_keys)
            missing = [k for k, key in enumerate(bert_keys) if key not in bert_cached]
            if bert_cached:
                logger.info(
                    "Job %s: BERTScore cache hits for %d of %d rows", job_id, len(bert_cached), len(bert_keys)
                )

            job.phase = "bertscore"
            job.bertscore_total = len(missing)
            job.bertscore_completed = 0
            await asyncio.to_thread(_db_save_status, job)

            bert_f1_scores: list[Optional[float]] = [bert_cached.get(key) for key in bert_keys]
            # Cached values show up immediately.
            for k, key in enumerate(bert_keys):
                if key in bert_cached:
                    i = successfully_translated[k][0]
                    job.sentence_metrics[i] = job.sentence_metrics[i].model_copy(update={"bertscore_f1": bert_cached[key]})

            def _on_bert_progress(completed: int, total_count: int, chunk_scores=None) -> None:
                # Runs on the worker thread: fill the rows of the chunk that
                # just finished, then persist (throttled).
                job.bertscore_total = total_count
                if chunk_scores:
                    start = completed - len(chunk_scores)
                    for offset, value in enumerate(chunk_scores):
                        k = missing[start + offset]
                        i = successfully_translated[k][0]
                        bert_f1_scores[k] = value
                        job.sentence_metrics[i] = job.sentence_metrics[i].model_copy(update={"bertscore_f1": float(value)})
                job.bertscore_completed = completed
                _db_save_status_throttled(job)

            if missing:
                try:
                    fresh_scores = await asyncio.to_thread(
                        compute_bertscore_batch,
                        [successfully_translated[k][1].llm_english_translation for k in missing],
                        [successfully_translated[k][1].english_reference for k in missing],
                        _on_bert_progress,
                        target_lang,
                    )
                except Exception as exc:
                    logger.error("Job %s BERTScore batch failed: %s", job_id, exc)
                    fresh_scores = [None] * len(missing)
                fresh_entries: list[tuple[str, float]] = []
                for k, value in zip(missing, fresh_scores):
                    bert_f1_scores[k] = value
                    if value is not None:
                        fresh_entries.append((bert_keys[k], float(value)))
                await asyncio.to_thread(_metric_cache_set_many, fresh_entries)

            # Update sentence_metrics with BERTScore
            for idx, (i, row) in enumerate(successfully_translated):
                existing = job.sentence_metrics[i]
                bert_val = (
                    float(bert_f1_scores[idx])
                    if idx < len(bert_f1_scores) and bert_f1_scores[idx] is not None
                    else None
                )
                job.sentence_metrics[i] = existing.model_copy(update={"bertscore_f1": bert_val})
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
        job.phase = "complete"
        await _persist(job)  # persist final results to survive future restarts
        _evict_oldest_terminal_jobs()
        logger.info("Job %s: complete", job_id)

    except Exception as exc:
        logger.error("Job %s: unhandled error in execute_job: %s", job_id, exc)
        job.status = JobStatus.failed
        job.phase = "failed"
        job.error = f"Job execution failed: {exc}"
        await _persist(job)
        _evict_oldest_terminal_jobs()

    finally:
        _executing.discard(job_id)