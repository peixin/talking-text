"""Content ingestion — extract language items from images and/or text.

Single LLM (vision) call per request. Returns a strict JSON shape so the
frontend drawer can render the preview without further processing.

See docs/2026-05-15-dev-log.md §7 for the prompt design rationale.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.adapters import factory
from app.api.auth import get_current_account
from app.storage.models.account import Account

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

_MAX_IMAGES = 5
_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB after frontend resize; safety cap

_EXTRACTION_PROMPT = """You are an English learning content analyst. Extract \
structured learning items from images and/or text that a parent provides for \
their child's English practice.

Output STRICTLY valid JSON matching this schema:

{
  "source_type": one of "textbook_page" "worksheet" "handwritten"
                 "flashcards" "screenshot" "other",
  "metadata": {
    "book_name": string | null,
    "unit": string | null,
    "lesson": string | null,
    "page": string | null,
    "confidence": "high" | "medium" | "low"
  },
  "items": [
    {
      "text": string,
      "type": "word" | "phrase" | "pattern",
      "anchor": string | null,
      "cefr": "A1".."C2" | null,
      "pos": one of "noun" "verb" "adj" "adv" "prep" "conj"
             "pron" "interj" "phrase" | null,
      "confidence": "high" | "medium" | "low",
      "note": string | null
    }
  ],
  "warnings": [string]
}

Rules:
1. ONLY English items. Skip Chinese translations even if present alongside.
2. word     = a single English word, e.g. "apple"
   phrase   = a fixed multi-word expression, e.g. "by the way"
   pattern  = a sentence template with blanks, e.g. "I like ___ and ___."
              For patterns, set anchor = lowercase fixed part (e.g. "i like").
3. Skip page numbers, copyright lines, publisher names, navigation text.
4. If part of the image is unreadable, add a warning; do NOT guess content.
5. CEFR rough guide: A1 = elementary K1-K3 vocabulary, A2 = K4-K6,
   B1 = middle school, B2 = high school, C1+ = advanced.
6. Confidence per item: high = clearly visible and unambiguous;
   medium = visible but you are inferring (e.g. CEFR estimate);
   low = guessing because text is unclear.
7. If image is not English language material, return source_type "other"
   and empty items array.
8. Return ONLY the JSON object. No prose, no markdown fences."""


# ── Schemas ──────────────────────────────────────────────────────────────────


SourceType = Literal[
    "textbook_page", "worksheet", "handwritten", "flashcards", "screenshot", "other"
]
ConfidenceLevel = Literal["high", "medium", "low"]
ItemType = Literal["word", "phrase", "pattern"]
CEFRLevel = Literal["A1", "A2", "B1", "B2", "C1", "C2"]


class ExtractedMetadata(BaseModel):
    book_name: str | None = None
    unit: str | None = None
    lesson: str | None = None
    page: str | None = None
    confidence: ConfidenceLevel = "low"


class ExtractedItem(BaseModel):
    text: str
    type: ItemType
    anchor: str | None = None
    cefr: CEFRLevel | None = None
    pos: str | None = None
    confidence: ConfidenceLevel = "medium"
    note: str | None = None


class IngestionResult(BaseModel):
    source_type: SourceType = "other"
    metadata: ExtractedMetadata = ExtractedMetadata()
    items: list[ExtractedItem] = []
    warnings: list[str] = []


# ── Helpers ──────────────────────────────────────────────────────────────────


_ENGLISH_RE = re.compile(r"^[\x20-\x7E\s'\-\.,?!]+$")


def _looks_english(text: str) -> bool:
    return bool(_ENGLISH_RE.match(text.strip()))


def _normalize_anchor(item: ExtractedItem) -> ExtractedItem:
    if item.type == "pattern" and not item.anchor:
        # If LLM forgot the anchor, derive from the literal text (lowercase, no blanks).
        anchor = re.sub(r"_+", " ", item.text).strip().lower()
        return item.model_copy(update={"anchor": anchor})
    if item.anchor is None:
        return item.model_copy(update={"anchor": item.text.lower()})
    return item


def _dedupe_items(items: list[ExtractedItem]) -> list[ExtractedItem]:
    seen: set[tuple[str, str]] = set()
    out: list[ExtractedItem] = []
    for raw in items:
        item = _normalize_anchor(raw)
        if not _looks_english(item.text):
            continue
        key = (item.type, item.text.strip())
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _parse_extraction(raw_text: str) -> IngestionResult:
    """Parse the LLM output. The prompt requests pure JSON, but be forgiving
    about a stray ```json fence the model sometimes adds."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    result = IngestionResult.model_validate(data)
    result.items = _dedupe_items(result.items)
    return result


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/extract", response_model=IngestionResult)
async def extract_content(
    _account: Annotated[Account, Depends(get_current_account)],
    description: Annotated[str | None, Form()] = None,
    images: Annotated[list[UploadFile] | None, File()] = None,
) -> IngestionResult:
    """Extract structured language items from images and/or a text description.

    Either ``description`` or at least one image is required. Returns the
    parsed JSON shape the frontend renders directly in the ingest drawer.
    """
    description = (description or "").strip()
    image_files = [img for img in (images or []) if img.filename]

    if not description and not image_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one image or a text description.",
        )

    if len(image_files) > _MAX_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At most {_MAX_IMAGES} images per request.",
        )

    image_bytes: list[bytes] = []
    image_mime = "image/jpeg"
    for img in image_files:
        data = await img.read()
        if len(data) > _MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each image must be ≤ 10 MB.",
            )
        image_bytes.append(data)
        if img.content_type and img.content_type.startswith("image/"):
            image_mime = img.content_type

    user_block = f'User provided this context (may be empty): "{description}"\n\n' + (
        f"Extract items from the attached image(s) ({len(image_bytes)})."
        if image_bytes
        else "Extract items from the description above."
    )
    full_prompt = f"{_EXTRACTION_PROMPT}\n\n---\n{user_block}"

    response_format: dict[str, Any] = {"type": "json_object"}

    try:
        if image_bytes:
            llm_response = await factory.vision.invoke_vision(
                full_prompt,
                image_bytes,
                image_mime=image_mime,
                max_tokens=2048,
                response_format=response_format,
            )
        else:
            from app.adapters.llm.protocol import LLMMessage

            llm_response = await factory.llm.invoke(
                [LLMMessage(role="user", content=full_prompt)],
                max_tokens=2048,
            )
    except NotImplementedError as e:
        log.exception("vision adapter not available")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Vision provider unavailable: {e}",
        ) from e
    except Exception as e:
        log.exception("ingestion LLM call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Extraction failed; please try again.",
        ) from e

    try:
        return _parse_extraction(llm_response.text)
    except (json.JSONDecodeError, ValueError):
        log.warning("invalid JSON from extraction LLM; raw=%r", llm_response.text[:500])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Extraction returned malformed data; please try again.",
        ) from None
