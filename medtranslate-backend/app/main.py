"""FastAPI application — MedTranslate backend."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from typing import Optional

from app.config import (
    CORS_ORIGINS,
    DEFAULT_MODEL,
    DEFAULT_SOURCE_LANGUAGE,
    DEFAULT_TARGET_LANGUAGE,
    LANGUAGES,
    build_system_prompt,
    REFERENCE_LANGUAGE_COLUMNS,
    SOURCE_LANGUAGE_COLUMNS,
)
from app.jobs import InputRow, cancel_job, create_job, execute_job, get_job_results, get_job_status, _db_cleanup_old_jobs
from app.schemas import JobCreated, JobResults, JobStatusResponse, ModelConfig
from app.translate import effective_reasoning_effort, effective_temperature

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


logger = logging.getLogger(__name__)

# Global concurrency limit on simultaneously executing jobs to prevent
# unbounded API spend from concurrent submissions.
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))
_job_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=20)
_worker_tasks: list[asyncio.Task] = []


async def _job_worker(worker_id: int) -> None:
    """Worker coroutine that pulls job IDs from the bounded queue and executes them."""
    while True:
        try:
            job_id = await _job_queue.get()
            logger.info("Worker %d: starting job %s", worker_id, job_id)
            try:
                await execute_job(job_id)
            except Exception as exc:
                logger.error("Worker %d: job %s failed: %s", worker_id, job_id, exc)
            finally:
                _job_queue.task_done()
        except asyncio.CancelledError:
            break


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: run TTL cleanup of old jobs
    await asyncio.to_thread(_db_cleanup_old_jobs, 7)
    # Start job worker pool
    for i in range(MAX_CONCURRENT_JOBS):
        task = asyncio.create_task(_job_worker(i))
        _worker_tasks.append(task)
    logger.info("Started %d job worker(s)", MAX_CONCURRENT_JOBS)
    yield
    # Shutdown: cancel worker tasks
    for task in _worker_tasks:
        task.cancel()
    await asyncio.gather(*_worker_tasks, return_exceptions=True)
    _worker_tasks.clear()


app = FastAPI(
    title="MedTranslate Backend",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.get("/")
async def health_check():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# File parsing helpers
# ---------------------------------------------------------------------------


class DetectedColumns(BaseModel):
    """Which columns hold the text to translate and the reference, and the
    translation direction those column names imply (None when the file uses
    the generic ``source_text`` / ``reference_text`` names)."""
    source_column: str
    reference_column: str
    source_language: Optional[str] = None
    target_language: Optional[str] = None


_NAME_TO_CODE = {name: code for code, name in LANGUAGES.items()}


def _detect_columns(
    headers: set[str],
    source_column: str | None = None,
    reference_column: str | None = None,
) -> DetectedColumns:
    """Work out the source and reference columns from the header row.

    The standard format names each column after its language:
    ``<language>_source`` holds the text to translate and
    ``<language>_reference`` the human translation it is scored against,
    e.g. ``spanish_source`` + ``english_reference`` (Spanish to English) or
    ``english_source`` + ``french_reference`` (English to French). Generic
    ``source_text`` / ``reference_text`` columns are also accepted; the
    direction then comes from the request instead. ``english_reference`` is
    still accepted as the reference column for files made for older versions.
    """
    src_col = source_column if source_column and source_column in headers else None
    ref_col = reference_column if reference_column and reference_column in headers else None
    if src_col is None:
        src_col = next((c for c in SOURCE_LANGUAGE_COLUMNS if c in headers), None)
    if ref_col is None:
        ref_col = next((c for c in REFERENCE_LANGUAGE_COLUMNS if c in headers), None)

    missing = []
    if src_col is None:
        missing.append('a source column such as "spanish_source" or "english_source"')
    if ref_col is None:
        missing.append('a reference column such as "english_reference" or "spanish_reference"')
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing " + " and ".join(missing) + ". Name the columns after their "
                "languages so the app knows which way to translate. Found: "
                + ", ".join(sorted(h for h in headers if h))
            ),
        )

    def lang_of(column: str, suffix: str) -> Optional[str]:
        if column.endswith(suffix):
            return _NAME_TO_CODE.get(column[: -len(suffix)])
        return None

    return DetectedColumns(
        source_column=src_col,
        reference_column=ref_col,
        source_language=lang_of(src_col, "_source"),
        target_language=lang_of(ref_col, "_reference"),
    )


def _parse_csv_content(
    content: bytes, source_column: str | None = None, reference_column: str | None = None,
) -> tuple[list[dict[str, str]], DetectedColumns]:
    """Parse CSV bytes into a list of row dicts. Returns (rows, detected columns)."""
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    found = {h.strip() for h in reader.fieldnames} if reader.fieldnames else set()
    detected = _detect_columns(found, source_column, reference_column)
    rows = [{(k or "").strip(): (v or "") for k, v in row.items()} for row in reader]
    return rows, detected


def _parse_xlsx_content(
    content: bytes, source_column: str | None = None, reference_column: str | None = None,
) -> tuple[list[dict[str, str]], DetectedColumns]:
    """Parse XLSX bytes into a list of row dicts using openpyxl (safe)."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        raise HTTPException(status_code=400, detail="No sheets found in the workbook")

    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise HTTPException(status_code=400, detail="Workbook sheet is empty")

    headers = [str(h).strip() if h is not None else "" for h in header_row]
    detected = _detect_columns(set(headers), source_column, reference_column)

    raw_rows: list[dict[str, str]] = []
    for row in rows_iter:
        obj = {}
        for idx, val in enumerate(row):
            if idx < len(headers) and headers[idx]:
                obj[headers[idx]] = str(val) if val is not None else ""
        raw_rows.append(obj)

    wb.close()
    return raw_rows, detected


def _raw_rows_to_input(raw_rows: list[dict[str, str]], columns: DetectedColumns) -> list[InputRow]:
    """Convert raw row dicts to InputRow objects with defaults."""
    rows: list[InputRow] = []
    for i, raw in enumerate(raw_rows):
        source_text = raw.get(columns.source_column, "") or raw.get("source_text", "")
        reference = raw.get(columns.reference_column, "") or raw.get("english_reference", "")
        rows.append(
            InputRow(
                pair_id=raw.get("pair_id") or f"row_{i + 1}",
                source=raw.get("source", "ClinSpEn_ClinicalCases"),
                content_type=raw.get("content_type", "clinical_case_report"),
                source_text=source_text,
                spanish_source=source_text,  # backward compat
                english_reference=reference,
                # A pre-filled translation (e.g. from an earlier export).
                llm_english_translation=raw.get("llm_english_translation", "") or raw.get("llm_translation", ""),
                # Optional: lets a metrics-only re-score keep failed rows'
                # status instead of treating them as untranslated.
                error=raw.get("error", "") or "",
                error_kind=raw.get("error_kind", "") or "",
            )
        )
    return rows


def _parse_upload(
    filename: str, content: bytes, source_column: str | None = None, reference_column: str | None = None,
) -> tuple[list[dict[str, str]], DetectedColumns]:
    """Route to the correct parser based on file extension."""
    name = filename.lower()
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return _parse_xlsx_content(content, source_column, reference_column)
    elif name.endswith(".csv"):
        return _parse_csv_content(content, source_column, reference_column)
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a .csv or .xlsx file.",
        )


# ---------------------------------------------------------------------------
# Response model for /v1/parse
# ---------------------------------------------------------------------------


class ParsedRow(BaseModel):
    pair_id: str
    source: str
    content_type: str
    english_reference: str
    source_text: str = ""
    spanish_source: str = ""  # backward compat
    llm_english_translation: str


class ParseResponse(BaseModel):
    rows: list[ParsedRow]
    # Which columns were used and the direction their names imply (null for
    # generic source_text / reference_text columns).
    source_column: str = ""
    reference_column: str = ""
    source_language: Optional[str] = None
    target_language: Optional[str] = None


# ---------------------------------------------------------------------------
# POST /v1/parse — parse a CSV or XLSX file and return normalized rows
# ---------------------------------------------------------------------------


@app.post("/v1/parse", response_model=ParseResponse)
async def parse_file(
    file: UploadFile = File(...),
    source_column: str = Form(""),
    reference_column: str = Form(""),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    raw_rows, columns = _parse_upload(file.filename, content, source_column or None, reference_column or None)

    if not raw_rows:
        raise HTTPException(status_code=400, detail="File contains no data rows")

    input_rows = _raw_rows_to_input(raw_rows, columns)

    return ParseResponse(
        source_column=columns.source_column,
        reference_column=columns.reference_column,
        source_language=columns.source_language,
        target_language=columns.target_language,
        rows=[
            ParsedRow(
                pair_id=r.pair_id,
                source=r.source,
                content_type=r.content_type,
                english_reference=r.english_reference,
                source_text=r.source_text,
                spanish_source=r.spanish_source,
                llm_english_translation=r.llm_english_translation,
            )
            for r in input_rows
        ]
    )


# ---------------------------------------------------------------------------
# POST /v1/jobs — submit CSV or XLSX + config
# ---------------------------------------------------------------------------


@app.post("/v1/jobs", response_model=JobCreated, status_code=202)
async def submit_job(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    # Empty means "build the standard instruction for the direction below".
    system_prompt: str = Form(""),
    temperature: float = Form(0.0),
    max_tokens: int = Form(1024),
    compute_bertscore: bool = Form(False),
    metrics_only: bool = Form(False),
    source_column: str = Form(""),
    reference_column: str = Form(""),
    # Language codes (see config.LANGUAGES). When omitted, the direction is
    # read from the column names, then falls back to Spanish -> English.
    source_language: str = Form(""),
    target_language: str = Form(""),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    raw_rows, columns = _parse_upload(file.filename, content, source_column or None, reference_column or None)

    if not raw_rows:
        raise HTTPException(status_code=400, detail="File contains no data rows")

    rows = _raw_rows_to_input(raw_rows, columns)

    src_lang = source_language or columns.source_language or DEFAULT_SOURCE_LANGUAGE
    tgt_lang = target_language or columns.target_language or DEFAULT_TARGET_LANGUAGE
    for code in (src_lang, tgt_lang):
        if code not in LANGUAGES:
            raise HTTPException(
                status_code=400,
                detail=f'Unsupported language "{code}". Supported: {", ".join(LANGUAGES)}',
            )
    if src_lang == tgt_lang:
        raise HTTPException(status_code=400, detail="Source and target language must differ")
    if not system_prompt.strip():
        system_prompt = build_system_prompt(src_lang, tgt_lang)

    # Request temperature 0 wherever the model accepts it (older OpenAI chat
    # models). Reasoning models and Claude reject the parameter, so for them
    # the recorded value is None: nothing was sent and output is not
    # guaranteed to be deterministic. The ``temperature`` form field is still
    # accepted for API compatibility but is overridden here.
    config = ModelConfig(
        model=model,
        system_prompt=system_prompt,
        temperature=effective_temperature(model, 0.0),
        max_tokens=max_tokens,
        compute_bertscore=compute_bertscore,
        metrics_only=metrics_only,
        reasoning_effort=effective_reasoning_effort(model),
        source_language=src_lang,
        target_language=tgt_lang,
    )

    job_id = await create_job(rows, config)

    try:
        _job_queue.put_nowait(job_id)
    except asyncio.QueueFull:
        raise HTTPException(
            status_code=503,
            detail="Server busy, try again shortly",
        )

    return JobCreated(job_id=job_id)


@app.post("/v1/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str):
    if not await cancel_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": "cancelled"}


@app.get("/v1/jobs/{job_id}", response_model=JobStatusResponse)
async def poll_job_status(job_id: str):
    status = await get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@app.get("/v1/jobs/{job_id}/results", response_model=JobResults)
async def get_results(
    job_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=0, ge=0),
):
    results = await get_job_results(job_id, offset=offset, limit=limit)
    if results is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return results
