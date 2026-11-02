"""Application configuration loaded from environment variables."""

import os


OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

# CORS origins allowed to call the backend (comma-separated).
# Defaults to "*" so the app works out-of-the-box on any deployment.
# Set CORS_ORIGINS env var to restrict (e.g. "https://myapp.onrender.com").
_cors_env = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else ["*"]
)

# Default translation settings
DEFAULT_MODEL: str = os.environ.get("DEFAULT_MODEL", "gpt-5.6-sol")
# Languages the app can translate between. Column names in uploaded files
# are built from the lowercase name: "<name>_source" holds the text to
# translate and "<name>_reference" the human translation to score against,
# so the file itself says which way the translation goes (e.g.
# spanish_source + english_reference, or english_source + french_reference).
# Keep in sync with LANGUAGES in lib/types.ts.
LANGUAGES: dict[str, str] = {
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "ko": "korean",
    "zh": "chinese",
    "pt": "portuguese",
    "de": "german",
    "ar": "arabic",
    "ja": "japanese",
    "ru": "russian",
}
DEFAULT_SOURCE_LANGUAGE: str = "es"
DEFAULT_TARGET_LANGUAGE: str = "en"


def language_label(code: str) -> str:
    """Human-readable name for a language code ("es" -> "Spanish")."""
    return LANGUAGES.get(code, code).capitalize()


def build_system_prompt(source_language: str, target_language: str) -> str:
    """Keep in sync with buildSystemPrompt() in lib/types.ts. The final sentence
    matters for scoring: metrics compare the whole reply to the reference, so a
    preamble or note counts as translation text and lowers BLEU sharply."""
    src = language_label(source_language)
    tgt = language_label(target_language)
    return (
        f"You are a medical interpreter. Translate the following {src} clinical "
        f"text into {tgt}, preserving all medical terminology and clinical meaning. "
        f"Output only the {tgt} translation, with no preamble, notes, quotation "
        "marks, or explanations."
    )


DEFAULT_SYSTEM_PROMPT: str = build_system_prompt(DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE)
DEFAULT_TEMPERATURE: float = 0.0
DEFAULT_MAX_TOKENS: int = 1024

# Reasoning / thinking effort for models that support it.
#   OpenAI (GPT-5.x / GPT-6 / o-series): none | low | medium | high | xhigh | max
#   Anthropic (Claude Opus 5.5 and other 4.6+ models): low | medium | high | xhigh | max
OPENAI_REASONING_EFFORT: str = os.environ.get("OPENAI_REASONING_EFFORT", "medium")
ANTHROPIC_EFFORT: str = os.environ.get("ANTHROPIC_EFFORT", "medium")

# Reasoning/thinking tokens count against the output-token limit on both
# providers. This many extra tokens are added on top of the requested
# max_tokens so reasoning never starves the translation itself.
REASONING_HEADROOM_TOKENS: int = int(os.environ.get("REASONING_HEADROOM_TOKENS", "4096"))

# Translation retry settings
TRANSLATE_MAX_RETRIES: int = 6
TRANSLATE_RETRY_DELAY: float = 4.0

# SQLite persistence — path to the database file.
# On Render, mount a Disk at /data and set DATABASE_PATH=/data/medtranslate.db.
# Leave unset (or keep the default) for local dev; the directory is created
# automatically if possible, and the app falls back to in-memory-only mode if
# the path cannot be written (e.g. the Render Disk is not mounted yet).
DATABASE_PATH: str = os.environ.get("DATABASE_PATH", "/data/medtranslate.db")

# Column names derived from the language table, plus the generic fallbacks.
SOURCE_LANGUAGE_COLUMNS: list[str] = [f"{name}_source" for name in LANGUAGES.values()] + ["source_text"]
REFERENCE_LANGUAGE_COLUMNS: list[str] = [f"{name}_reference" for name in LANGUAGES.values()] + ["reference_text"]
