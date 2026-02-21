"""OpenAI translation with retry logic and rate-limit awareness."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import openai

from app.config import (
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    OPENAI_API_KEY,
    TRANSLATE_MAX_RETRIES,
    TRANSLATE_RETRY_DELAY,
)

logger = logging.getLogger(__name__)

_client: Optional[openai.AsyncOpenAI] = None


def _get_client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        _client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _client


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
    last_error: Exception | None = None

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
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
            wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
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
                wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
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
            wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1))
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
