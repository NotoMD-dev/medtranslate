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
DEFAULT_MODEL: str = os.environ.get("DEFAULT_MODEL", "gpt-4o")
DEFAULT_SYSTEM_PROMPT: str = (
    "You are a medical interpreter. Translate the following Spanish clinical "
    "text into English, preserving all medical terminology and clinical meaning."
)
DEFAULT_TEMPERATURE: float = 0.0
DEFAULT_MAX_TOKENS: int = 1024

# Translation retry settings
TRANSLATE_MAX_RETRIES: int = 3
TRANSLATE_RETRY_DELAY: float = 2.0

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
