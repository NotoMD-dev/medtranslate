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


def _bertscore_subprocess(candidates: list[str], references: list[str]) -> list[float]:
    """Run BERTScore in a subprocess so the ~400MB model is freed after completion."""
    payload = json.dumps({"candidates": candidates, "references": references})
    result = subprocess.run(
        [sys.executable, _BERTSCORE_WORKER],
        input=payload,
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute timeout for large batches
    )
    if result.returncode != 0:
        raise RuntimeError(f"BERTScore subprocess failed: {result.stderr}")
    output = json.loads(result.stdout)
    return output["f1_scores"]


def compute_bertscore_batch(
    candidates: list[str],
    references: list[str],
) -> list[float]:
    if not candidates:
        return []

    if len(candidates) != len(references):
        raise ValueError(
            f"BERTScore length mismatch: {len(candidates)} candidates vs {len(references)} references"
        )

    return _bertscore_subprocess(candidates, references)


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
