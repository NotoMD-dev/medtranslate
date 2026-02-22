#!/usr/bin/env python3
"""
Batch translate Spanish clinical text using OpenAI or Anthropic APIs.

Usage:
    python translate_batch.py \
        --input data/unified_translation_dataset.csv \
        --output data/results_with_translations.csv \
        --model gpt-5.2 \
        --api openai
"""

import argparse
import csv
import os
import sys
import time
from typing import Iterator


SYSTEM_PROMPT = (
    "You are a medical interpreter. Translate the following Spanish clinical "
    "text into English, preserving all medical terminology and clinical meaning. "
    "Output ONLY the English translation, nothing else."
)


def _uses_max_completion_tokens(model: str) -> bool:
    """Return True if the model requires max_completion_tokens instead of max_tokens."""
    model_lower = model.lower()
    if model_lower.startswith(("o1", "o3", "o4")):
        return True
    if "gpt-4o" in model_lower:
        return True
    return False


def translate_openai(text: str, model: str) -> str:
    """Translate using OpenAI API."""
    import openai
    client = openai.OpenAI()
    token_param = (
        {"max_completion_tokens": 1024}
        if _uses_max_completion_tokens(model)
        else {"max_tokens": 1024}
    )
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        **token_param,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    )
    return response.choices[0].message.content.strip()


def translate_anthropic(text: str, model: str) -> str:
    """Translate using Anthropic API."""
    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    return response.content[0].text.strip()


def read_csv(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser(description="Batch translate medical text")
    parser.add_argument("--input", required=True, help="Input CSV path")
    parser.add_argument("--output", required=True, help="Output CSV path")
    parser.add_argument("--model", default="gpt-4o", help="Model name")
    parser.add_argument(
        "--api", choices=["openai", "anthropic"], default="openai",
        help="API provider"
    )
    parser.add_argument("--start", type=int, default=0, help="Start index (for resuming)")
    parser.add_argument("--limit", type=int, default=None, help="Max rows to translate")
    parser.add_argument("--delay", type=float, default=0.1, help="Delay between API calls (seconds)")
    args = parser.parse_args()

    translate_fn = translate_openai if args.api == "openai" else translate_anthropic
    rows = read_csv(args.input)
    total = len(rows)

    if args.limit:
        end = min(args.start + args.limit, total)
    else:
        end = total

    print(f"Translating rows {args.start} to {end} of {total} using {args.api}/{args.model}")

    for i in range(args.start, end):
        row = rows[i]
        if row.get("llm_english_translation"):
            print(f"  [{i+1}/{total}] Already translated, skipping")
            continue

        try:
            translation = translate_fn(row["spanish_source"], args.model)
            rows[i]["llm_english_translation"] = translation
            print(f"  [{i+1}/{total}] OK ({len(translation)} chars)")
        except Exception as e:
            print(f"  [{i+1}/{total}] ERROR: {e}")
            rows[i]["llm_english_translation"] = f"ERROR: {e}"

        if args.delay > 0:
            time.sleep(args.delay)

        # Checkpoint every 50 rows
        if (i + 1) % 50 == 0:
            _write_csv(args.output, rows)
            print(f"  Checkpoint saved at row {i+1}")

    _write_csv(args.output, rows)
    translated = sum(1 for r in rows if r.get("llm_english_translation") and not r["llm_english_translation"].startswith("ERROR"))
    print(f"\nDone. {translated}/{total} rows translated. Saved to {args.output}")


def _write_csv(path: str, rows: list[dict]):
    if not rows:
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
