"""Application configuration loaded from environment variables."""

import os


OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")

# CORS origins allowed to call the backend (comma-separated).
# Default allows common local dev ports and any Vercel preview URL.
CORS_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

# Default translation settings
DEFAULT_MODEL: str = os.environ.get("DEFAULT_MODEL", "gpt-5.2")
DEFAULT_SYSTEM_PROMPT: str = (
    "You are a medical interpreter. Translate the following Spanish clinical "
    "text into English, preserving all medical terminology and clinical meaning."
)
DEFAULT_TEMPERATURE: float = 0.0
DEFAULT_MAX_TOKENS: int = int(os.environ.get("DEFAULT_MAX_TOKENS", "512"))

# Translation retry settings.
# 5 retries × 4 s base with exponential back-off gives a ~60 s recovery window,
# long enough to survive a full per-minute rate-limit cycle.
TRANSLATE_MAX_RETRIES: int = int(os.environ.get("TRANSLATE_MAX_RETRIES", "5"))
TRANSLATE_RETRY_DELAY: float = float(os.environ.get("TRANSLATE_RETRY_DELAY", "4.0"))
TRANSLATE_MAX_BACKOFF: float = float(os.environ.get("TRANSLATE_MAX_BACKOFF", "30.0"))

# Disable OpenAI SDK auto-retries by default so only app-level backoff runs.
OPENAI_MAX_RETRIES: int = int(os.environ.get("OPENAI_MAX_RETRIES", "0"))

# Global OpenAI concurrency (per process)
# Limits how many simultaneous OpenAI requests can run.
OPENAI_CONCURRENCY: int = int(os.environ.get("OPENAI_CONCURRENCY", "1"))