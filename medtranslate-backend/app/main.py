"""FastAPI application — MedTranslate backend."""

from __future__ import annotations

import asyncio
import csv
import io
import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS, DEFAULT_SYSTEM_PROMPT
from app.jobs import InputRow, create_job, execute_job, get_job_results, get_job_status
from app.schemas import JobCreated, JobResults, JobStatusResponse, ModelConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="MedTranslate Backend",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/v1/jobs", response_model=JobCreated, status_code=202)
async def submit_job(
    file: UploadFile = File(...),
    model: str = Form("5.2"),
    system_prompt: str = Form(DEFAULT_SYSTEM_PROMPT),
    temperature: float = Form(0.0),
    max_tokens: int = Form(1024),
    compute_bertscore: bool = Form(False),
):

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None or "spanish_source" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail='CSV must contain "spanish_source" column')

    rows: list[InputRow] = []

    for i, raw in enumerate(reader):
        rows.append(
            InputRow(
                pair_id=raw.get("pair_id") or f"row_{i + 1}",
                source=raw.get("source", "ClinSpEn_ClinicalCases"),
                content_type=raw.get("content_type", "clinical_case_report"),
                spanish_source=raw.get("spanish_source", ""),
                english_reference=raw.get("english_reference", ""),
                llm_english_translation=raw.get("llm_english_translation", ""),
            )
        )

    if not rows:
        raise HTTPException(status_code=400, detail="CSV contains no data rows")

    config = ModelConfig(
        model=model,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        compute_bertscore=compute_bertscore,
    )

    job_id = create_job(rows, config)

    asyncio.create_task(execute_job(job_id))

    return JobCreated(job_id=job_id)


@app.get("/v1/jobs/{job_id}", response_model=JobStatusResponse)
async def poll_job_status(job_id: str):
    status = get_job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@app.get("/v1/jobs/{job_id}/results", response_model=JobResults)
async def get_results(job_id: str):
    results = get_job_results(job_id)
    if results is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return results