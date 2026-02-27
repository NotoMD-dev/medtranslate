"""FastAPI application — MedTranslate backend."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from app.config import CORS_ORIGINS, DEFAULT_SYSTEM_PROMPT, SOURCE_LANGUAGE_COLUMNS
from app.jobs import InputRow, cancel_job, create_job, execute_job, get_job_results, get_job_status
from app.schemas import JobCreated, JobResults, JobStatusResponse, ModelConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="MedTranslate Backend",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


# ---------------------------------------------------------------------------
# File parsing helpers
# ---------------------------------------------------------------------------


def _detect_source_column(headers: set[str]) -> str:
    """Find the source text column from the available headers."""
    for col in SOURCE_LANGUAGE_COLUMNS:
        if col in headers:
            return col
    return "source_text"


def _parse_csv_content(content: bytes, source_column: str | None = None) -> tuple[list[dict[str, str]], str]:
    """Parse CSV bytes into a list of row dicts. Returns (rows, detected_source_column)."""
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    found = set(reader.fieldnames) if reader.fieldnames else set()

    # Determine source column
    src_col = source_column if source_column and source_column in found else _detect_source_column(found)

    required_cols = {src_col, "english_reference"}
    missing = required_cols - found
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f'Missing required column(s): {", ".join(sorted(missing))}. Found: {", ".join(sorted(found))}',
        )

    return list(reader), src_col


def _parse_xlsx_content(content: bytes, source_column: str | None = None) -> tuple[list[dict[str, str]], str]:
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
    header_set = set(headers)

    # Determine source column
    src_col = source_column if source_column and source_column in header_set else _detect_source_column(header_set)

    required_cols = {src_col, "english_reference"}
    missing = required_cols - header_set
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f'Missing required column(s): {", ".join(sorted(missing))}. Found: {", ".join(headers)}',
        )

    raw_rows: list[dict[str, str]] = []
    for row in rows_iter:
        obj = {}
        for idx, val in enumerate(row):
            if idx < len(headers) and headers[idx]:
                obj[headers[idx]] = str(val) if val is not None else ""
        raw_rows.append(obj)

    wb.close()
    return raw_rows, src_col


def _raw_rows_to_input(raw_rows: list[dict[str, str]], source_column: str = "spanish_source") -> list[InputRow]:
    """Convert raw row dicts to InputRow objects with defaults."""
    rows: list[InputRow] = []
    for i, raw in enumerate(raw_rows):
        source_text = raw.get(source_column, "") or raw.get("source_text", "") or raw.get("spanish_source", "")
        rows.append(
            InputRow(
                pair_id=raw.get("pair_id") or f"row_{i + 1}",
                source=raw.get("source", "ClinSpEn_ClinicalCases"),
                content_type=raw.get("content_type", "clinical_case_report"),
                source_text=source_text,
                spanish_source=source_text,  # backward compat
                english_reference=raw.get("english_reference", ""),
                llm_english_translation=raw.get("llm_english_translation", ""),
            )
        )
    return rows


def _parse_upload(filename: str, content: bytes, source_column: str | None = None) -> tuple[list[dict[str, str]], str]:
    """Route to the correct parser based on file extension."""
    name = filename.lower()
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return _parse_xlsx_content(content, source_column)
    elif name.endswith(".csv"):
        return _parse_csv_content(content, source_column)
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


# ---------------------------------------------------------------------------
# POST /v1/parse — parse a CSV or XLSX file and return normalized rows
# ---------------------------------------------------------------------------


@app.post("/v1/parse", response_model=ParseResponse)
async def parse_file(
    file: UploadFile = File(...),
    source_column: str = Form(""),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    raw_rows, detected_col = _parse_upload(file.filename, content, source_column or None)

    if not raw_rows:
        raise HTTPException(status_code=400, detail="File contains no data rows")

    input_rows = _raw_rows_to_input(raw_rows, detected_col)

    return ParseResponse(
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
    model: str = Form("gpt-4o"),
    system_prompt: str = Form(DEFAULT_SYSTEM_PROMPT),
    temperature: float = Form(0.0),
    max_tokens: int = Form(1024),
    compute_bertscore: bool = Form(False),
    metrics_only: bool = Form(False),
    source_column: str = Form(""),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    raw_rows, detected_col = _parse_upload(file.filename, content, source_column or None)

    if not raw_rows:
        raise HTTPException(status_code=400, detail="File contains no data rows")

    rows = _raw_rows_to_input(raw_rows, detected_col)

    config = ModelConfig(
        model=model,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        compute_bertscore=compute_bertscore,
        metrics_only=metrics_only,
    )

    job_id = create_job(rows, config)

    asyncio.create_task(execute_job(job_id))

    return JobCreated(job_id=job_id)


@app.post("/v1/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str):
    if not cancel_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": "cancelled"}


@app.get("/v1/jobs/{job_id}", response_model=JobStatusResponse)
async def poll_job_status(job_id: str):
    status = get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@app.get("/v1/jobs/{job_id}/results", response_model=JobResults)
async def get_results(
    job_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=0, ge=0),
):
    results = get_job_results(job_id, offset=offset, limit=limit)
    if results is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return results
