"""LLM translation with retry logic and rate-limit awareness.

Supports OpenAI and Anthropic models. The provider is selected automatically
based on the model name (claude-* → Anthropic, everything else → OpenAI).
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
from typing import Optional

import openai

from app.config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_EFFORT,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    OPENAI_API_KEY,
    OPENAI_REASONING_EFFORT,
    REASONING_HEADROOM_TOKENS,
    TRANSLATE_MAX_RETRIES,
    TRANSLATE_RETRY_DELAY,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Failure classification
# ---------------------------------------------------------------------------


class TranslationRefused(RuntimeError):
    """The model answered but produced no translation (content filter,
    explicit refusal, or an empty reply). This is model behaviour and is
    scored as a failed translation, unlike infrastructure errors."""


def classify_error(exc: BaseException) -> str:
    """Return ``"refusal"`` or ``"infrastructure"`` for a translation error.

    Refusals count against the model. Everything else (rate limits exhausted,
    connection errors, provider 5xx, bad configuration, output limit reached
    before any text was produced) says nothing about translation quality and
    is reported as incomplete so the rows can be retried.
    """
    return "refusal" if isinstance(exc, TranslationRefused) else "infrastructure"


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


def _is_openai_reasoning_model(model: str) -> bool:
    """GPT-5.x (incl. gpt-5.6-sol/terra/luna), GPT-6 and o-series models.

    These take ``reasoning_effort``, require ``max_completion_tokens`` instead
    of ``max_tokens``, and reject ``temperature`` / ``top_p`` outright (the
    request fails on the parameter's presence, whatever its value).
    """
    m = model.lower()
    return m.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4"))


def _uses_max_completion_tokens(model: str) -> bool:
    return _is_openai_reasoning_model(model)


def _supports_temperature(model: str) -> bool:
    return not _is_openai_reasoning_model(model)


_ANTHROPIC_EFFORT_MODELS = re.compile(r"^claude-(?:opus|sonnet|haiku|fable|mythos)-(?:[5-9]|4-[6-9])")


def _anthropic_supports_effort(model: str) -> bool:
    """Claude 4.6+ models accept adaptive thinking and ``output_config.effort``."""
    return bool(_ANTHROPIC_EFFORT_MODELS.match(model.lower()))


def effective_temperature(model: str, requested: float) -> Optional[float]:
    """Return the temperature that will actually be sent for *model*.

    ``None`` means the parameter is not sent at all: GPT-5.x/GPT-6/o-series
    reasoning models and current Claude models reject it on presence. Only
    older OpenAI chat models receive the requested value. Recording this on
    the job keeps ``translation_config`` honest about what the provider saw.
    """
    if _is_anthropic_model(model):
        return None
    return requested if _supports_temperature(model) else None


def effective_reasoning_effort(model: str) -> Optional[str]:
    """Return the effort setting that will be sent for *model*, or None.

    Mirrors the branching in the provider-specific translate functions so the
    value recorded on a job matches what the request actually used.
    """
    if _is_anthropic_model(model):
        return ANTHROPIC_EFFORT if _anthropic_supports_effort(model) else None
    return OPENAI_REASONING_EFFORT if _is_openai_reasoning_model(model) else None


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
    temperature: Optional[float] = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """Translate a single clinical text to English via OpenAI or Anthropic.

    ``temperature`` is only forwarded to models that accept it (see
    :func:`effective_temperature`); ``None`` means "do not send".

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
    temperature: Optional[float],
    max_tokens: int,
) -> str:
    client = _get_openai_client()
    last_error: Exception | None = None

    # Reasoning models (gpt-5.6-sol etc.) take reasoning_effort, use
    # max_completion_tokens, and reject temperature/top_p on presence alone.
    # Reasoning tokens count against max_completion_tokens, so add headroom.
    request_kwargs: dict = {}
    if _is_openai_reasoning_model(model):
        effort = OPENAI_REASONING_EFFORT
        request_kwargs["reasoning_effort"] = effort
        headroom = 0 if effort == "none" else REASONING_HEADROOM_TOKENS
        request_kwargs["max_completion_tokens"] = max_tokens + headroom
    else:
        request_kwargs["max_tokens"] = max_tokens
        request_kwargs["temperature"] = DEFAULT_TEMPERATURE if temperature is None else temperature

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                **request_kwargs,
            )
            choice = response.choices[0]
            content = (choice.message.content or "").strip()
            if not content and choice.finish_reason == "length":
                raise RuntimeError(
                    "Output limit reached before any translation was produced; "
                    "raise max_tokens or REASONING_HEADROOM_TOKENS"
                )
            if not content and choice.finish_reason == "content_filter":
                raise TranslationRefused("Model declined to translate this text (content filter)")
            if not content:
                raise TranslationRefused(
                    f"Model returned an empty reply (finish_reason: {choice.finish_reason})"
                )
            return content

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
    temperature: Optional[float],  # noqa: ARG001 - see note below
    max_tokens: int,
) -> str:
    client = _get_anthropic_client()
    last_error: Exception | None = None

    # Current Claude models (Opus 5.5 and the rest of the 4.6+ family) reject
    # non-default sampling parameters, so ``temperature`` is not forwarded.
    # Adaptive thinking is enabled with the configured effort; thinking tokens
    # count against max_tokens, so headroom is added on top of the requested
    # limit. ``output_config`` is sent via extra_body so the request does not
    # depend on the installed SDK version knowing that field.
    request_kwargs: dict = {"max_tokens": max_tokens}
    if _anthropic_supports_effort(model):
        request_kwargs["thinking"] = {"type": "adaptive"}
        request_kwargs["extra_body"] = {"output_config": {"effort": ANTHROPIC_EFFORT}}
        request_kwargs["max_tokens"] = max_tokens + REASONING_HEADROOM_TOKENS

    for attempt in range(1, TRANSLATE_MAX_RETRIES + 1):
        try:
            import anthropic

            response = await client.messages.create(
                model=model,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": text},
                ],
                **request_kwargs,
            )
            if response.stop_reason == "refusal":
                details = getattr(response, "stop_details", None)
                category = getattr(details, "category", None) or "unspecified"
                raise TranslationRefused(f"Model declined to translate this text (category: {category})")
            content = _anthropic_text(response).strip()
            if not content and response.stop_reason == "max_tokens":
                raise RuntimeError(
                    "Output limit reached before any translation was produced; "
                    "raise max_tokens or REASONING_HEADROOM_TOKENS"
                )
            if not content:
                raise TranslationRefused(
                    f"Model returned an empty reply (stop_reason: {response.stop_reason})"
                )
            return content

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
