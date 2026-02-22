"""OpenAI translation with rate-limit pacing.

The OpenAI SDK handles 429 retries internally (exponential back-off,
jitter, Retry-After header parsing) when ``max_retries`` > 0.  We
layer a token-bucket rate limiter on top to *pace* outbound requests
and avoid hitting the limit in the first place, and keep a thin
app-level retry for connection / 5xx errors the SDK doesn't cover
as well.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from typing import Optional

import openai

from app.config import (
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    OPENAI_API_KEY,
    OPENAI_CONCURRENCY,
    OPENAI_MAX_RETRIES,
    TRANSLATE_MAX_RETRIES,
    TRANSLATE_RETRY_DELAY,
)

logger = logging.getLogger(__name__)

_client: Optional[openai.AsyncOpenAI] = None
_semaphore: Optional[asyncio.Semaphore] = None


# ---------------------------------------------------------------------------
# Token-bucket rate limiter — paces outbound requests so we stay below
# the API's RPM / TPM limits.
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Async token-bucket rate limiter."""

    def __init__(self, rate: float):
        self._rate = rate  # tokens (requests) per second
        self._tokens = rate
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
            self._last = now

            if self._tokens < 1.0:
                wait = (1.0 - self._tokens) / self._rate
                await asyncio.sleep(wait)
                self._tokens = 0.0
                self._last = time.monotonic()
            else:
                self._tokens -= 1.0


_GLOBAL_RATE = float(os.getenv("TRANSLATE_REQUESTS_PER_SECOND", "1"))
_rate_limiter = _RateLimiter(_GLOBAL_RATE)


def _get_client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        _client = openai.AsyncOpenAI(
            api_key=OPENAI_API_KEY,
            max_retries=OPENAI_MAX_RETRIES,
        )
    return _client


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        limit = OPENAI_CONCURRENCY if OPENAI_CONCURRENCY and OPENAI_CONCURRENCY > 0 else 1
        _semaphore = asyncio.Semaphore(limit)
    return _semaphore


async def translate_text(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """Translate a single Spanish clinical text to English via OpenAI.

    Rate-limit (429) retries are delegated to the SDK (``max_retries``).
    App-level retries here only cover connection and server (5xx) errors.
    """
    client = _get_client()
    sem = _get_semaphore()
    last_error: Exception | None = None

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            async with sem:
                await _rate_limiter.acquire()
                response = await client.chat.completions.create(
                    model=model,
                    temperature=temperature,
                    max_completion_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": text},
                    ],
                )
            content = response.choices[0].message.content
            return (content or "").strip()

        except openai.RateLimitError:
            # The SDK already retried max_retries times and still got
            # 429 — re-raising here so the caller marks the row failed
            # rather than hammering the API further.
            raise

        except openai.APIStatusError as exc:
            if exc.status_code >= 500:
                last_error = exc
                wait = min(
                    TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                    + random.uniform(0, TRANSLATE_RETRY_DELAY),
                    30.0,
                )
                if attempt < TRANSLATE_MAX_RETRIES:
                    logger.warning(
                        "Server error %d (attempt %d/%d), retrying in %.1fs",
                        exc.status_code, attempt, TRANSLATE_MAX_RETRIES, wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(
                        "Server error %d (attempt %d/%d), no retries left",
                        exc.status_code, attempt, TRANSLATE_MAX_RETRIES,
                    )
            else:
                raise

        except openai.APIConnectionError as exc:
            last_error = exc
            wait = min(
                TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                + random.uniform(0, TRANSLATE_RETRY_DELAY),
                30.0,
            )
            if attempt < TRANSLATE_MAX_RETRIES:
                logger.warning(
                    "Connection error (attempt %d/%d), retrying in %.1fs",
                    attempt, TRANSLATE_MAX_RETRIES, wait,
                )
                await asyncio.sleep(wait)
            else:
                logger.error(
                    "Connection error (attempt %d/%d), no retries left",
                    attempt, TRANSLATE_MAX_RETRIES,
                )

    raise RuntimeError(
        f"Translation failed after {TRANSLATE_MAX_RETRIES} attempts: {last_error}"
    )
