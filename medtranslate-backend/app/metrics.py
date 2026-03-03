"""Research-grade metric computation."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import nltk
import sacrebleu
from nltk.tokenize import word_tokenize
from nltk.translate.meteor_score import meteor_score

logger = logging.getLogger(__name__)

# Ensure required NLTK resources
for resource in ("wordnet", "omw-1.4", "punkt_tab"):
    try:
        nltk.data.find(
            f"corpora/{resource}"
            if resource != "punkt_tab"
            else f"tokenizers/{resource}"
        )
    except LookupError:
        nltk.download(resource, quiet=True)


# ---------------------------------------------------------------------------
# Corpus BLEU
# ---------------------------------------------------------------------------

def compute_corpus_bleu(
    hypotheses: list[str],
    references: list[str],
) -> tuple[float, str]:
    if not hypotheses or not references:
        return 0.0, "N/A (no reference translations available)"
    bleu = sacrebleu.corpus_bleu(hypotheses, [references])
    return bleu.score, bleu.format()


# ---------------------------------------------------------------------------
# METEOR (canonical NLTK implementation)
# ---------------------------------------------------------------------------

def compute_meteor(candidate: str, reference: str) -> float:
    candidate = (candidate or "").strip()
    reference = (reference or "").strip()

    if not candidate or not reference:
        return 0.0

    return float(meteor_score([word_tokenize(reference)], word_tokenize(candidate)))


# ---------------------------------------------------------------------------
# BERTScore (runs in a subprocess to avoid ~400MB torch staying in main process)
# ---------------------------------------------------------------------------

# Path to the subprocess helper script
_BERTSCORE_WORKER = str(Path(__file__).resolve().parent.parent / "bertscore_worker.py")


def _bertscore_subprocess(
    candidates: list[str],
    references: list[str],
    on_progress: "Optional[callable]" = None,
) -> list[float]:
    """Run BERTScore in a subprocess so the ~400MB model is freed after completion.

    The worker processes inputs in chunks and writes JSON-line progress
    messages to stdout, allowing the caller to track completion via the
    optional *on_progress(completed, total)* callback.
    """
    # Keep chunks reasonably small so progress updates are meaningful on large jobs
    # even when BERTSCORE_CHUNK_SIZE is set too high in the environment.
    requested_chunk_size = int(os.getenv("BERTSCORE_CHUNK_SIZE", "256"))
    chunk_size = max(32, min(requested_chunk_size, 512, len(candidates)))
    payload = json.dumps({
        "candidates": candidates,
        "references": references,
        "chunk_size": chunk_size,
    })
    proc = subprocess.Popen(
        [sys.executable, _BERTSCORE_WORKER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert proc.stdin is not None
    proc.stdin.write(payload)
    proc.stdin.close()

    f1_scores: list[float] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("type") == "progress" and on_progress:
            on_progress(msg["completed"], msg["total"])
        elif msg.get("type") == "done":
            f1_scores = msg["f1_scores"]

    returncode = proc.wait(timeout=600)
    if returncode != 0:
        stderr_text = proc.stderr.read() if proc.stderr else ""
        raise RuntimeError(f"BERTScore subprocess failed: {stderr_text}")

    return f1_scores


def compute_bertscore_batch(
    candidates: list[str],
    references: list[str],
    on_progress: "Optional[callable]" = None,
) -> list[float]:
    if not candidates:
        return []

    if len(candidates) != len(references):
        raise ValueError(
            f"BERTScore length mismatch: {len(candidates)} candidates vs {len(references)} references"
        )

    return _bertscore_subprocess(candidates, references, on_progress)


# ---------------------------------------------------------------------------
# Version reporting
# ---------------------------------------------------------------------------

def get_library_versions() -> dict[str, str]:
    versions: dict[str, str] = {
        "sacrebleu": sacrebleu.__version__,
        "nltk": nltk.__version__,
    }

    # Only report torch/bert-score versions if they are already imported
    try:
        import torch
        import bert_score as bs
        versions["torch"] = torch.__version__
        versions["bert_score"] = bs.__version__
    except ImportError:
        versions["torch"] = "not loaded"
        versions["bert_score"] = "not loaded"

    return versions
