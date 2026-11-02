"""LLM translation with retry logic and rate-limit awareness.

Supports OpenAI and Anthropic models. The provider is selected automatically
based on the model name (claude-* → Anthropic, everything else → OpenAI).
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Optional

import openai

from app.config import (
    ANTHROPIC_API_KEY,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    OPENAI_API_KEY,
    TRANSLATE_MAX_RETRIES,
    TRANSLATE_RETRY_DELAY,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy-loaded clients
# ---------------------------------------------------------------------------

_openai_client: Optional[openai.AsyncOpenAI] = None
_anthropic_client = None  # type: ignore[annotation-unchecked]


def _get_openai_client() -> openai.AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        _openai_client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        try:
            import anthropic
        except ImportError:
            raise RuntimeError(
                "anthropic package is not installed. Run: pip install anthropic"
            )
        _anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


def _is_anthropic_model(model: str) -> bool:
    return model.startswith("claude")


def _uses_max_completion_tokens(model: str) -> bool:
    """Newer OpenAI models (GPT 5.x, o-series) require max_completion_tokens instead of max_tokens."""
    m = model.lower()
    return m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")


def _supports_temperature(model: str) -> bool:
    """Some OpenAI reasoning models reject explicit temperature values."""
    return not model.lower().startswith("gpt-5")


def _anthropic_thinking_kwargs(model: str) -> dict:
    """Thinking configuration for Anthropic models.

    Claude Sonnet 5.5 runs adaptive thinking by default and thinking tokens
    count against ``max_tokens``. Translation is a single-shot task where we
    want every output token spent on the translation itself, so request the
    lowest thinking setting. ``between_tools`` is only accepted by Sonnet 5.5;
    other models are sent with their defaults.
    """
    if model.lower().startswith("claude-sonnet-5-5"):
        return {"thinking": {"type": "between_tools"}}
    return {}


def _anthropic_text(response) -> str:
    """Concatenate the text blocks of a Messages API response.

    Responses may begin with ``thinking`` blocks, so the first block cannot
    be assumed to be text.
    """
    return "".join(
        getattr(block, "text", "") for block in (response.content or []) if getattr(block, "type", "") == "text"
    )


# ---------------------------------------------------------------------------
# Translation entry point
# ---------------------------------------------------------------------------


async def translate_text(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """Translate a single clinical text to English via OpenAI or Anthropic.

    Retries on transient errors (rate-limit, server errors) with
    exponential back-off.
    """
    if _is_anthropic_model(model):
        return await _translate_anthropic(
            text,
            model=model,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    return await _translate_openai(
        text,
        model=model,
        system_prompt=system_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )


# ---------------------------------------------------------------------------
# OpenAI translation
# ---------------------------------------------------------------------------


async def _translate_openai(
    text: str,
    *,
    model: str,
    system_prompt: str,
    temperature: float,
    max_tokens: int,
) -> str:
    client = _get_openai_client()
    last_error: Exception | None = None

    # Newer OpenAI models require max_completion_tokens instead of max_tokens
    token_kwargs: dict = {}
    if _uses_max_completion_tokens(model):
        token_kwargs["max_completion_tokens"] = max_tokens
    else:
        token_kwargs["max_tokens"] = max_tokens

    sampling_kwargs: dict = {}
    if _supports_temperature(model):
        sampling_kwargs["temperature"] = temperature

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            response = await client.chat.completions.create(
                model=model,
                **sampling_kwargs,
                **token_kwargs,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
            )
            content = response.choices[0].message.content
            return (content or "").strip()

        except openai.RateLimitError as exc:
            last_error = exc
            retry_after = None
            if hasattr(exc, "response") and exc.response is not None:
                retry_after_str = exc.response.headers.get("retry-after")
                if retry_after_str:
                    try:
                        retry_after = float(retry_after_str)
                    except (ValueError, TypeError):
                        pass
            wait = retry_after if retry_after else TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
            logger.warning(
                "Rate limited (attempt %d/%d), retrying in %.1fs%s",
                attempt,
                TRANSLATE_MAX_RETRIES,
                wait,
                " (from Retry-After header)" if retry_after else "",
            )
            await asyncio.sleep(wait)

        except openai.APIStatusError as exc:
            if exc.status_code >= 500:
                last_error = exc
                wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
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
            wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
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


# ---------------------------------------------------------------------------
# Anthropic translation
# ---------------------------------------------------------------------------


async def _translate_anthropic(
    text: str,
    *,
    model: str,
    system_prompt: str,
    temperature: float,  # noqa: ARG001 - see note below
    max_tokens: int,
) -> str:
    client = _get_anthropic_client()
    last_error: Exception | None = None

    # Current Claude models (Sonnet 5.5 and the rest of the 4.6+ family) reject
    # non-default sampling parameters, so ``temperature`` is not forwarded.
    # Decoding is already as deterministic as the API allows.
    thinking_kwargs = _anthropic_thinking_kwargs(model)

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            import anthropic

            response = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": text},
                ],
                **thinking_kwargs,
            )
            if response.stop_reason == "refusal":
                details = getattr(response, "stop_details", None)
                category = getattr(details, "category", None) or "unspecified"
                raise RuntimeError(f"Model declined to translate this text (category: {category})")
            return _anthropic_text(response).strip()

        except anthropic.RateLimitError as exc:
            last_error = exc
            retry_after = None
            if hasattr(exc, "response") and exc.response is not None:
                retry_after_str = exc.response.headers.get("retry-after")
                if retry_after_str:
                    try:
                        retry_after = float(retry_after_str)
                    except (ValueError, TypeError):
                        pass
            wait = retry_after if retry_after else TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
            logger.warning(
                "Anthropic rate limited (attempt %d/%d), retrying in %.1fs%s",
                attempt,
                TRANSLATE_MAX_RETRIES,
                wait,
                " (from Retry-After header)" if retry_after else "",
            )
            await asyncio.sleep(wait)

        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                last_error = exc
                wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
                logger.warning(
                    "Anthropic server error %d (attempt %d/%d), retrying in %.1fs",
                    exc.status_code,
                    attempt,
                    TRANSLATE_MAX_RETRIES,
                    wait,
                )
                await asyncio.sleep(wait)
            else:
                raise

        except anthropic.APIConnectionError as exc:
            last_error = exc
            wait = TRANSLATE_RETRY_DELAY * (2 ** (attempt - 1)) * (0.5 + random.random())
            logger.warning(
                "Anthropic connection error (attempt %d/%d), retrying in %.1fs",
                attempt,
                TRANSLATE_MAX_RETRIES,
                wait,
            )
            await asyncio.sleep(wait)

    raise RuntimeError(
        f"Translation failed after {TRANSLATE_MAX_RETRIES} attempts: {last_error}"
    )
