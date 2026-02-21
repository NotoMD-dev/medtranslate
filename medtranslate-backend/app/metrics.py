"""Research-grade metric computation.

All metric outputs match the reference Python library implementations exactly.
No shortcuts or approximations are used.

- Corpus BLEU: sacrebleu (default 13a tokenization)
- METEOR: NLTK meteor_score with WordNet + stemming
- BERTScore: bert-score with rescale_with_baseline=True
"""

from __future__ import annotations

import logging
from typing import Optional

import nltk
import sacrebleu
import torch
from bert_score import score as bert_score_fn
from nltk.translate.meteor_score import single_meteor_score

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Ensure required NLTK data is available
# ---------------------------------------------------------------------------
for resource in ("wordnet", "omw-1.4", "punkt", "punkt_tab"):
    try:
        nltk.data.find(f"corpora/{resource}" if resource != "punkt" and resource != "punkt_tab" else f"tokenizers/{resource}")
    except LookupError:
        nltk.download(resource, quiet=True)


# ---------------------------------------------------------------------------
# Corpus BLEU (sacrebleu)
# ---------------------------------------------------------------------------

def compute_corpus_bleu(
    hypotheses: list[str],
    references: list[str],
) -> tuple[float, str]:
    """Compute corpus-level BLEU using sacrebleu with default 13a tokenization.

    Returns (score, signature_string).
    """
    bleu = sacrebleu.corpus_bleu(hypotheses, [references])
    return bleu.score, str(bleu)


# ---------------------------------------------------------------------------
# Sentence-level METEOR (NLTK, full implementation)
# ---------------------------------------------------------------------------

def compute_meteor(candidate: str, reference: str) -> float:
    """Compute METEOR score with WordNet synonym matching and Porter stemming.

    Uses NLTK's single_meteor_score which includes:
    - Exact matching
    - Porter stemming
    - WordNet synonym matching
    - Alignment penalty (fragmentation)
    """
    ref_tokens = nltk.word_tokenize(reference.lower())
    cand_tokens = nltk.word_tokenize(candidate.lower())
    if not cand_tokens or not ref_tokens:
        return 0.0
    return single_meteor_score(ref_tokens, cand_tokens)


# ---------------------------------------------------------------------------
# BERTScore (HuggingFace bert-score, rescaled)
# ---------------------------------------------------------------------------

def compute_bertscore_batch(
    candidates: list[str],
    references: list[str],
    batch_size: int = 64,
) -> list[float]:
    """Compute BERTScore F1 for a batch of candidate/reference pairs.

    Uses rescale_with_baseline=True as required for publication.
    Returns list of F1 scores.
    """
    if not candidates:
        return []

    _P, _R, F1 = bert_score_fn(
        candidates,
        references,
        lang="en",
        rescale_with_baseline=True,
        batch_size=batch_size,
        verbose=False,
    )
    return F1.tolist()


# ---------------------------------------------------------------------------
# Library version reporting
# ---------------------------------------------------------------------------

def get_library_versions() -> dict[str, str]:
    """Return versions of all metric libraries for reproducibility."""
    import bert_score as bs

    return {
        "sacrebleu": sacrebleu.__version__,
        "nltk": nltk.__version__,
        "bert_score": bs.__version__,
        "torch": torch.__version__,
    }
