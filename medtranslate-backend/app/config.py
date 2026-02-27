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

# Redis persistence (optional — leave unset to fall back to in-memory only)
# Set REDIS_URL to a Redis connection string, e.g. "redis://localhost:6379/0"
# or use a Render Redis add-on URL.
REDIS_URL: str = os.environ.get("REDIS_URL", "")

# How long to keep job data in Redis (default: 7 days)
JOB_TTL_SECONDS: int = int(os.environ.get("JOB_TTL_SECONDS", str(7 * 24 * 3600)))

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
