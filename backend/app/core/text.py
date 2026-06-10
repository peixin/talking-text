"""Shared English text tokenization — used by the organize inbox and the
weekly report, both of which derive word data from turn text (CLAUDE.md rule #3).
"""

from __future__ import annotations

import re

_WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")


def tokenize_words(text: str) -> list[str]:
    """Lowercase alphabetic word tokens (contractions kept). Pure."""
    return _WORD_RE.findall(text.lower())
