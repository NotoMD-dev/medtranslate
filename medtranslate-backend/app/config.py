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
# Keep in sync with buildSystemPrompt() in lib/types.ts. The final sentence
# matters for scoring: metrics compare the whole reply to the reference, so a
# preamble or note counts as translation text and lowers BLEU sharply.
DEFAULT_SYSTEM_PROMPT: str = (
    "You are a medical interpreter. Translate the following Spanish clinical "
    "text into English, preserving all medical terminology and clinical meaning. "
    "Output only the English translation, with no preamble, notes, quotation "
    "marks, or explanations."
)
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

# Known source language column names
SOURCE_LANGUAGE_COLUMNS: list[str] = [
    "spanish_source",
    "french_source",
    "korean_source",
    "chinese_source",
    "portuguese_source",
    "german_source",
    "arabic_source",
    "japanese_source",
    "russian_source",
    "source_text",
]
