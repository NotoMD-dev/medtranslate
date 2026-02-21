"""Research-grade metric computation."""

from __future__ import annotations

import logging
import os
from typing import Optional

import nltk
import sacrebleu
from nltk.translate.meteor_score import meteor_score

logger = logging.getLogger(__name__)

# Ensure required NLTK resources
for resource in ("wordnet", "omw-1.4", "punkt"):
    try:
        nltk.data.find(
            f"corpora/{resource}"
            if resource != "punkt"
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
    bleu = sacrebleu.corpus_bleu(hypotheses, [references])
    return bleu.score, bleu.signature


# ---------------------------------------------------------------------------
# METEOR (canonical NLTK implementation)
# ---------------------------------------------------------------------------

def compute_meteor(candidate: str, reference: str) -> float:
    candidate = (candidate or "").strip()
    reference = (reference or "").strip()

    if not candidate or not reference:
        return 0.0

    return float(meteor_score([reference], candidate))


# ---------------------------------------------------------------------------
# BERTScore (lazy-loaded to avoid ~400MB torch import at startup)
# ---------------------------------------------------------------------------

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

    try:
        batch_size = int(os.getenv("BERTSCORE_BATCH_SIZE", "64"))
    except ValueError:
        batch_size = 64

    # Lazy import: torch + bert_score are ~400MB in RAM.
    # Only load when BERTScore is explicitly requested.
    from bert_score import score as bert_score_fn

    _P, _R, F1 = bert_score_fn(
        candidates,
        references,
        model_type="roberta-base",
        lang="en",
        rescale_with_baseline=True,
        batch_size=batch_size,
        verbose=False,
    )

    return F1.tolist()


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
