"""OpenAI translation with retry logic and rate-limit awareness."""

from __future__ import annotations

import asyncio
import logging
import random
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
    try:
        resp = getattr(exc, "response", None)
        if resp is None:
            return None
        headers = getattr(resp, "headers", None)
        if not headers:
            return None
        ra = headers.get("retry-after") or headers.get("Retry-After")
        if ra is None:
            return None
        return float(ra)
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
            async with sem:
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
                wait = retry_after
            else:
                base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                jitter = random.uniform(0, base * 0.5)
                wait = base + jitter

            logger.warning(
                "Rate limited (attempt %d/%d), retrying in %.1fs",
                attempt,
                TRANSLATE_MAX_RETRIES,
                wait,
            )
            await asyncio.sleep(wait)

        except openai.APIStatusError as exc:
            if exc.status_code >= 500:
                last_error = exc
                base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
                jitter = random.uniform(0, base * 0.5)
                wait = base + jitter
                logger.warning(
                    "Server error %d (attempt %d/%d), retrying in %.1fs",
                    exc.status_code,
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                    wait,
                )
                await asyncio.sleep(wait)
            else:
                raise

        except openai.APIConnectionError as exc:
            last_error = exc
            base = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
            jitter = random.uniform(0, base * 0.5)
            wait = base + jitter
            logger.warning(
                "Connection error (attempt %d/%d), retrying in %.1fs",
                attempt,
                TRANSLATE_MAX_RETRIES,
                wait,
            )
            await asyncio.sleep(wait)

    raise RuntimeError(
        f"Translation failed after {TRANSLATE_MAX_RETRIES} attempts: {last_error}"
    )