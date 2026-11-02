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

from app.config import DATABASE_PATH

logger = logging.getLogger(__name__)

# Ensure required NLTK resources. omw-2.0 (Open Multilingual WordNet) is
# what current NLTK releases read for non-English synonym lookups; omw-1.4
# is kept for older releases. A missing download only disables synonym
# matches for that language (see _MultilingualWordNet).
for resource in ("wordnet", "omw-1.4", "omw-2.0", "punkt_tab"):
    try:
        nltk.data.find(
            f"corpora/{resource}"
            if resource != "punkt_tab"
            else f"tokenizers/{resource}"
        )
    except LookupError:
        try:
            nltk.download(resource, quiet=True)
        except Exception:  # pragma: no cover - network / packaging issues
            pass


# ---------------------------------------------------------------------------
# Language support for scoring
# ---------------------------------------------------------------------------
#
# Every metric compares the model's translation with the human reference, so
# both are in the job's *target* language, and that language decides how the
# text is tokenized, stemmed and looked up for synonyms.

# Languages written without spaces between words. They are scored on
# characters: sacrebleu's "zh" / "char" tokenizers for BLEU, and one token per
# character for METEOR (exact character matches only; no stemming or synonyms).
_CHARACTER_LANGUAGES = {"zh", "ja", "ko"}

# NLTK Snowball stemmer languages (used by METEOR for word-form matches).
_SNOWBALL_LANGUAGES = {
    "en": "english", "es": "spanish", "fr": "french", "pt": "portuguese",
    "de": "german", "ru": "russian", "ar": "arabic",
}

# NLTK punkt_tab languages (word tokenization for METEOR).
_PUNKT_LANGUAGES = {
    "en": "english", "es": "spanish", "fr": "french", "pt": "portuguese",
    "de": "german", "ru": "russian",
}

# Open Multilingual WordNet (omw-1.4) language codes, for METEOR synonym
# matches. Languages missing here get exact and stem matches only.
_OMW_LANGUAGES = {
    "en": "eng", "es": "spa", "fr": "fra", "pt": "por", "ja": "jpn", "zh": "cmn", "ar": "arb",
}


def bleu_tokenizer(lang: str) -> str:
    """sacrebleu tokenizer for the target language.

    "zh" is sacrebleu's Chinese tokenizer. Japanese and Korean need the
    optional MeCab packages; when those are missing the "char" tokenizer is
    used so the score is still defined. Everything else uses the default
    "13a" tokenizer.
    """
    if lang == "zh":
        return "zh"
    if lang in ("ja", "ko"):
        name = "ja-mecab" if lang == "ja" else "ko-mecab"
        try:
            from sacrebleu.tokenizers import TOKENIZERS
            TOKENIZERS[name]()
            return name
        except Exception:
            return "char"
    return "13a"


def _meteor_tokenize(text: str, lang: str) -> list[str]:
    if lang in _CHARACTER_LANGUAGES:
        return [ch for ch in text if not ch.isspace()]
    try:
        return word_tokenize(text, language=_PUNKT_LANGUAGES.get(lang, "english"))
    except LookupError:
        return word_tokenize(text)


class _IdentityStemmer:
    def stem(self, word: str) -> str:
        return word


class _SynsetProxy:
    """Presents a WordNet synset's lemmas in the target language, which is
    what NLTK's METEOR reads when it looks for synonym matches."""

    def __init__(self, synset, lang: str):
        self._synset = synset
        self._lang = lang

    def lemmas(self):
        try:
            return self._synset.lemmas(lang=self._lang)
        except Exception:
            return []


class _MultilingualWordNet:
    """WordNet lookups routed through the Open Multilingual WordNet."""

    def __init__(self, lang: str):
        self._lang = lang

    def synsets(self, word: str):
        from nltk.corpus import wordnet
        try:
            return [_SynsetProxy(s, self._lang) for s in wordnet.synsets(word, lang=self._lang)]
        except Exception:
            return []


class _NoWordNet:
    def synsets(self, word: str):
        return []


def _meteor_resources(lang: str):
    """(stemmer, wordnet) objects METEOR should use for the target language."""
    if lang == "en":
        from nltk.corpus import wordnet
        from nltk.stem.porter import PorterStemmer
        return PorterStemmer(), wordnet
    if lang in _SNOWBALL_LANGUAGES:
        from nltk.stem.snowball import SnowballStemmer
        stemmer = SnowballStemmer(_SNOWBALL_LANGUAGES[lang])
    else:
        stemmer = _IdentityStemmer()
    omw = _OMW_LANGUAGES.get(lang)
    return stemmer, (_MultilingualWordNet(omw) if omw else _NoWordNet())


def scoring_notes(lang: str) -> str:
    """One line describing how the target language is scored, for the UI."""
    parts = []
    if lang in _CHARACTER_LANGUAGES:
        parts.append("BLEU and METEOR scored on characters")
        parts.append("no stemming or synonym matching")
    else:
        parts.append("stemming " + ("on" if lang in _SNOWBALL_LANGUAGES else "off"))
        parts.append("synonyms " + ("on" if lang in _OMW_LANGUAGES else "off"))
    return "; ".join(parts)


# ---------------------------------------------------------------------------
# Corpus BLEU
# ---------------------------------------------------------------------------

def compute_corpus_bleu(
    hypotheses: list[str],
    references: list[str],
    lang: str = "en",
) -> tuple[float, str]:
    if not hypotheses or not references:
        return 0.0, "N/A (no reference translations available)"
    bleu = sacrebleu.corpus_bleu(hypotheses, [references], tokenize=bleu_tokenizer(lang))
    return bleu.score, bleu.format()


# ---------------------------------------------------------------------------
# METEOR (canonical NLTK implementation)
# ---------------------------------------------------------------------------

def compute_meteor(candidate: str, reference: str, lang: str = "en") -> float:
    candidate = (candidate or "").strip()
    reference = (reference or "").strip()

    if not candidate or not reference:
        return 0.0

    stemmer, wordnet = _meteor_resources(lang)
    return float(
        meteor_score(
            [_meteor_tokenize(reference, lang)],
            _meteor_tokenize(candidate, lang),
            stemmer=stemmer,
            wordnet=wordnet,
        )
    )


# ---------------------------------------------------------------------------
# BERTScore (runs in a subprocess to avoid ~400MB torch staying in main process)
# ---------------------------------------------------------------------------

# Path to the subprocess helper script
_BERTSCORE_WORKER = str(Path(__file__).resolve().parent.parent / "bertscore_worker.py")


def _bertscore_subprocess(
    candidates: list[str],
    references: list[str],
    on_progress: "Optional[callable]" = None,
    lang: str = "en",
) -> list[float]:
    """Run BERTScore in a subprocess so the ~400MB model is freed after completion.

    The worker processes inputs in chunks and writes JSON-line progress
    messages to stdout, allowing the caller to track completion via the
    optional *on_progress(completed, total, chunk_scores)* callback, where
    *chunk_scores* holds the F1 values of the chunk just finished.
    """
    # Keep chunks reasonably small so progress updates are meaningful on large jobs
    # even when BERTSCORE_CHUNK_SIZE is set too high in the environment.
    requested_chunk_size = int(os.getenv("BERTSCORE_CHUNK_SIZE", "256"))
    chunk_size = max(32, min(requested_chunk_size, 512, len(candidates)))
    payload = json.dumps({
        "candidates": candidates,
        "references": references,
        "chunk_size": chunk_size,
        "lang": lang,
    })
    # Keep the HuggingFace model cache on the persistent disk (next to the
    # SQLite file) so roberta-base is downloaded once per deployment rather
    # than once per container start.
    env = os.environ.copy()
    if "HF_HOME" not in env:
        cache_dir = os.path.join(os.path.dirname(DATABASE_PATH) or ".", "hf-cache")
        try:
            os.makedirs(cache_dir, exist_ok=True)
            env["HF_HOME"] = cache_dir
        except OSError:
            pass  # not writable: fall back to the default cache location

    proc = subprocess.Popen(
        [sys.executable, _BERTSCORE_WORKER],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        # Discard stderr to prevent the OS pipe buffer from filling up and
        # deadlocking: if the subprocess writes >64 KB to stderr (e.g. tqdm
        # progress bars from the HuggingFace model download) it blocks waiting
        # for the parent to drain the pipe.  The parent is simultaneously
        # blocked in the stdout-reading loop, so neither side can proceed.
        stderr=subprocess.DEVNULL,
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
            on_progress(msg["completed"], msg["total"], msg.get("scores"))
        elif msg.get("type") == "done":
            f1_scores = msg["f1_scores"]

    returncode = proc.wait(timeout=600)
    if returncode != 0:
        raise RuntimeError(f"BERTScore subprocess exited with code {returncode}")

    return f1_scores


def bertscore_model(lang: str) -> str:
    """Model BERTScore uses for the target language (see bertscore_worker.py)."""
    return "roberta-base" if lang == "en" else "bert-base-multilingual-cased"


def compute_bertscore_batch(
    candidates: list[str],
    references: list[str],
    on_progress: "Optional[callable]" = None,
    lang: str = "en",
) -> list[float]:
    if not candidates:
        return []

    if len(candidates) != len(references):
        raise ValueError(
            f"BERTScore length mismatch: {len(candidates)} candidates vs {len(references)} references"
        )

    return _bertscore_subprocess(candidates, references, on_progress, lang)


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
