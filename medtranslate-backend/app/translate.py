"""OpenAI translation with retry logic and rate-limit awareness."""

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
    TRANSLATE_MAX_BACKOFF,
    TRANSLATE_MAX_RETRIES,
    TRANSLATE_RETRY_DELAY,
)

logger = logging.getLogger(__name__)

_client: Optional[openai.AsyncOpenAI] = None
_semaphore: Optional[asyncio.Semaphore] = None


# ---------------------------------------------------------------------------
# Token-bucket rate limiter — gates every outbound API call (including
# retries) so that 429 back-off is respected globally.
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Async token-bucket rate limiter with penalty support."""

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

    async def penalize(self, seconds: float) -> None:
        """Drain tokens so the next ``acquire()`` waits at least *seconds*.

        Called after a 429 to propagate back-pressure to all concurrent
        callers, not just the one that was rate-limited.
        """
        async with self._lock:
            self._tokens = -(seconds * self._rate)
            self._last = time.monotonic()


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


def _retry_after_seconds(exc: Exception) -> Optional[float]:
    """Extract a wait-time hint from the 429 response headers.

    Checks the standard ``Retry-After`` header first, then falls back to
    OpenAI's ``x-ratelimit-reset-requests`` (format: ``"6s"``, ``"200ms"``).
    """
    try:
        resp = getattr(exc, "response", None)
        if resp is None:
            return None
        headers = getattr(resp, "headers", None)
        if not headers:
            return None

        # Standard header (seconds as a plain number)
        ra = headers.get("retry-after")
        if ra is not None:
            val = float(ra)
            logger.debug("Retry-After header present: %s (%.1fs)", ra, val)
            return val

        # OpenAI-specific header, e.g. "6s", "200ms", "1m30s"
        reset = headers.get("x-ratelimit-reset-requests")
        if reset is not None:
            val = _parse_duration(reset)
            if val is not None:
                logger.debug("x-ratelimit-reset-requests header: %s (%.1fs)", reset, val)
                return val

        logger.debug("No retry-after hint in 429 response headers")
        return None
    except Exception:
        return None


def _parse_duration(s: str) -> Optional[float]:
    """Parse a compact duration like ``'6s'``, ``'200ms'``, or ``'1m30s'``."""
    import re

    try:
        total = 0.0
        for value, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(ms|s|m|h)", s):
            n = float(value)
            if unit == "ms":
                total += n / 1000
            elif unit == "s":
                total += n
            elif unit == "m":
                total += n * 60
            elif unit == "h":
                total += n * 3600
        return total if total > 0 else None
    except Exception:
        return None


async def translate_text(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """Translate a single Spanish clinical text to English via OpenAI.

    Retries on transient errors (rate-limit, server errors) with
    exponential back-off.
    """
    client = _get_client()
    sem = _get_semaphore()
    last_error: Exception | None = None

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            # Acquire the rate limiter *inside* the concurrency semaphore so
            # that only one caller at a time reaches the bucket, keeping the
            # pacing accurate.  Every attempt — including retries — goes
            # through the limiter (this was previously skipped on retries).
            async with sem:
                await _rate_limiter.acquire()
                response = await client.chat.completions.create(
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": text},
                    ],
                )
            content = response.choices[0].message.content
            return (content or "").strip()

        except openai.RateLimitError as exc:
            last_error = exc

            retry_after = _retry_after_seconds(exc)
            if retry_after is not None and retry_after > 0:
                wait = min(retry_after, TRANSLATE_MAX_BACKOFF)
            else:
                base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                wait = min(base + random.uniform(0, base * 0.5),
                           TRANSLATE_MAX_BACKOFF)

            # Penalise the global rate limiter so *all* concurrent callers
            # slow down — not just this one.
            await _rate_limiter.penalize(wait)

            if attempt < TRANSLATE_MAX_RETRIES:
                logger.warning(
                    "Rate limited (attempt %d/%d), retrying in %.1fs",
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                    wait,
                )
                await asyncio.sleep(wait)
            else:
                logger.error(
                    "Rate limited (attempt %d/%d), no retries left",
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                )

        except openai.APIStatusError as exc:
            if exc.status_code >= 500:
                last_error = exc
                base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                wait = min(base + random.uniform(0, base * 0.5),
                           TRANSLATE_MAX_BACKOFF)

                if attempt < TRANSLATE_MAX_RETRIES:
                    logger.warning(
                        "Server error %d (attempt %d/%d), retrying in %.1fs",
                        exc.status_code,
                        attempt,
                        TRANSLATE_MAX_RETRIES,
                        wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.error(
                        "Server error %d (attempt %d/%d), no retries left",
                        exc.status_code,
                        attempt,
                        TRANSLATE_MAX_RETRIES,
                    )
            else:
                raise

        except openai.APIConnectionError as exc:
            last_error = exc
            base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
            wait = min(base + random.uniform(0, base * 0.5),
                       TRANSLATE_MAX_BACKOFF)

            if attempt < TRANSLATE_MAX_RETRIES:
                logger.warning(
                    "Connection error (attempt %d/%d), retrying in %.1fs",
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                    wait,
                )
                await asyncio.sleep(wait)
            else:
                logger.error(
                    "Connection error (attempt %d/%d), no retries left",
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                )

    raise RuntimeError(
        f"Translation failed after {TRANSLATE_MAX_RETRIES} attempts: {last_error}"
    )