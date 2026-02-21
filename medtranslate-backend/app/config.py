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

# App-level retries (connection errors, 5xx only — 429s are handled by SDK).
TRANSLATE_MAX_RETRIES: int = int(os.environ.get("TRANSLATE_MAX_RETRIES", "3"))
TRANSLATE_RETRY_DELAY: float = float(os.environ.get("TRANSLATE_RETRY_DELAY", "2.0"))

# OpenAI SDK auto-retries — handles 429 rate-limit back-off with proper
# Retry-After header parsing, exponential back-off, and jitter.
OPENAI_MAX_RETRIES: int = int(os.environ.get("OPENAI_MAX_RETRIES", "2"))

# Global OpenAI concurrency (per process)
# Limits how many simultaneous OpenAI requests can run.
OPENAI_CONCURRENCY: int = int(os.environ.get("OPENAI_CONCURRENCY", "1"))