"""Heuristic checks on raw model output.

The study scores the model's reply exactly as returned, so nothing here
modifies text. These checks only *flag* replies that look like they contain
something other than the translation (a preamble, a translator's note,
quotation marks, markdown) so reviewers can see why a score may be low.
"""

from __future__ import annotations

import re
from typing import Optional

_PREAMBLE = re.compile(
    r"^\s*(?:"
    r"here(?:'s|’s| is| are)\b"
    r"|sure\b"
    r"|certainly\b"
    r"|of course\b"
    r"|(?:the )?(?:english )?translation(?: is| reads| follows)?\s*:"
    r"|translated text\s*:"
    r"|english\s*:"
    r")",
    re.IGNORECASE,
)

_NOTE = re.compile(
    r"(?:^|\n)\s*[\(\[]?\s*(?:note|notes|translator'?s note|translation note|n\.b\.)\s*[:\-–—]",
    re.IGNORECASE,
)

_MARKDOWN = re.compile(r"(\*\*|__|^#{1,6}\s|^\s*[-*•]\s|^\s*\d+\.\s)", re.MULTILINE)

_OPEN_QUOTES = ("\"", "“", "«", "'", "‘")
_CLOSE_QUOTES = ("\"", "”", "»", "'", "’")


def detect_format_warning(translation: str, source_text: str = "") -> Optional[str]:
    """Return a short description of suspicious wrapper content, or None.

    Conservative by design: a clean single-sentence translation never
    triggers. Several findings are joined with "; ".
    """
    text = (translation or "").strip()
    if not text:
        return None

    findings: list[str] = []

    if _PREAMBLE.search(text):
        findings.append("starts with a preamble")

    if _NOTE.search(text):
        findings.append("contains a translator's note")

    if len(text) > 2 and text[0] in _OPEN_QUOTES and text[-1] in _CLOSE_QUOTES:
        findings.append("wrapped in quotation marks")

    if _MARKDOWN.search(text):
        findings.append("contains markdown formatting")

    # Extra paragraphs are only suspicious when the source had none.
    if "\n\n" in text and "\n\n" not in (source_text or ""):
        findings.append("contains extra paragraphs")

    return "; ".join(findings) if findings else None
