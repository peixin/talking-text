"""Content ingestion — extract language items from images and/or text.

Single LLM (vision) call per request. Returns a strict JSON shape so the
frontend drawer can render the preview without further processing.

Extraction is deliberately NOT a librarian: it returns the language items plus a
suggested name and CEFR estimate only. It does NOT infer where the material
belongs in any textbook hierarchy (no parent_id, no levels) — structuring is a
separate, deliberate act in the organize workbench. See docs/content-lifecycle.md
§4 (organize workbench) and §8 (what changed).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.adapters import factory
from app.adapters.stt.protocol import STTRequest
from app.api.auth import get_current_account
from app.audio_codec import webm_opus_to_ogg
from app.storage.models.account import Account

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

_MAX_IMAGES = 5
_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB after frontend resize; safety cap

_EXTRACTION_PROMPT = """You help parents register English study material. A single \
capture mixes two DIFFERENT kinds of input, and your first job is to tell them apart:

  • MATERIAL — the actual study content: the attached image(s), and any English text \
the parent pastes verbatim as content to be learned. You EXTRACT learning items \
(words, phrase collocations, sentence patterns) from MATERIAL.
  • PARENT NOTE — the parent's OWN words ABOUT the material: context, requests, or \
reminders, e.g. "this is Unit 3 vocab", "重点练 r 的发音", "focus on the question \
patterns", "孩子见过这些词了". This may be in ANY language and any style. It is \
GUIDANCE, not content — never extract items from it, and never translate, correct, \
grade, or complain about it.

Output STRICTLY valid JSON matching this schema:

{
  "source_type": one of "textbook_page" "worksheet" "handwritten"
                 "flashcards" "screenshot" "other",
  "source_raw_text": string | null,
  "metadata": {
    "suggested_name": string | null,
    "cefr_level": "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null,
    "confidence": "high" | "medium" | "low",
    "parent_note": string | null
  },
  "items": [
    {
      "text": string,
      "type": "word" | "phrase" | "pattern",
      "anchor": string | null,
      "cefr": "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null,
      "pos": one of "noun" "verb" "adj" "adv" "prep" "conj"
             "pron" "interj" "phrase" | null,
      "confidence": "high" | "medium" | "low",
      "note": string | null
    }
  ],
  "warnings": [string]
}

Rules:
1. Items come from the MATERIAL only. Use the PARENT NOTE to STEER extraction \
(what to focus on, scope, difficulty) — do NOT turn the note's text into items.
2. `metadata.parent_note`: concisely restate the parent's instructions / notes / \
requirements, in their ORIGINAL language (do not translate). Null if the parent \
supplied only content with no commentary. NEVER flag the note's language or grammar.
3. Do NOT correct, rewrite, or critique spelling, grammar, or usage of ANY text — \
capture it as it appears (e.g. keep "a unknown world" exactly as written). You are \
an extractor, not a proofreader.
4. Item Types:
   - "word": A single English word, e.g. "apple", "beautiful".
   - "phrase": A multi-word fixed collocation, idiom, or lexical chunk, \
e.g. "by the way", "look after".
   - "pattern": A sentence pattern or grammar structure template with \
blanks, e.g. "I like ___ and ___.", "Can you help me ___?".
                For patterns, set `anchor` to the lowercase fixed part of \
the pattern (e.g. "i like" or "can you help me").
5. CEFR Difficulty: Estimate the overall CEFR difficulty level \
(`metadata.cefr_level`) of the entire material (A1 = elementary/K1-K3, \
A2 = high elementary/K4-K6, B1 = middle school, B2 = high school, C1+ = advanced).
6. Suggested Name (`metadata.suggested_name`): A short, natural label (2-20 \
characters, in the material's apparent language) for THIS captured set of items — \
e.g. "Unit 3 words", "动物单词", "Colors". This is ONLY a naming suggestion the \
parent will confirm or rename. You do NOT decide where this set belongs in any \
textbook hierarchy — that is done later by a person. Do not output book/unit/lesson \
structure or parent references.
7. Skip page numbers, copyright blocks, publisher names, and system instructions.
8. Transcribe the FULL English text of the MATERIAL into `source_raw_text` as a raw \
script string.
9. `warnings`: ONLY for problems that block extraction — an unreadable image, or no \
extractable English content at all. NEVER warn about non-English text, the parent's \
language choice, or grammar/spelling style.
10. Return ONLY the JSON object. Do not include any markdown fences \
or explanation before/after the JSON."""


# ── Schemas ──────────────────────────────────────────────────────────────────


SourceType = Literal[
    "textbook_page", "worksheet", "handwritten", "flashcards", "screenshot", "other"
]
ConfidenceLevel = Literal["high", "medium", "low"]
ItemType = Literal["word", "phrase", "pattern"]
CEFRLevel = Literal["A1", "A2", "B1", "B2", "C1", "C2"]


class ExtractedMetadata(BaseModel):
    #: A naming suggestion only — the parent confirms/renames. Extraction never
    #: decides hierarchy placement (see module docstring).
    suggested_name: str | None = None
    cefr_level: CEFRLevel | None = None
    confidence: ConfidenceLevel = "low"
    #: The parent's own words ABOUT the material (context / requests / reminders),
    #: in their original language. Steers extraction and is preserved as the
    #: group's prompt_notes — it is NEVER extracted as content or grammar-checked.
    parent_note: str | None = None


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
    source_raw_text: str | None = None
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

    user_block = ""
    if description:
        user_block += (
            "The parent's text input below (manual and/or transcribed voice) may "
            "contain BOTH the material itself (English content to extract) AND the "
            "parent's own notes/requests about it (any language). Separate them per "
            "the rules: extract only the material, and capture the parent's own words "
            "into metadata.parent_note.\n"
            f'"{description}"\n\n'
        )
    if image_bytes:
        user_block += (
            f"The {len(image_bytes)} attached image(s) are MATERIAL — extract learning "
            f"items from them, steered by any parent notes above."
        )
    elif description:
        user_block += (
            "There is no image; the material, if any, is whatever English content "
            "appears in the text above (the rest is the parent's note)."
        )

    full_prompt = f"{_EXTRACTION_PROMPT}\n\n--- CURRENT UPLOAD CONTEXT ---\n{user_block}"

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


class TranscribeResult(BaseModel):
    text: str


@router.post("/transcribe", response_model=TranscribeResult)
async def transcribe_audio(
    _account: Annotated[Account, Depends(get_current_account)],
    audio: Annotated[UploadFile, File()],
) -> TranscribeResult:
    """Run STT on the uploaded audio and return the transcript only.

    Used by the ingest drawer's voice trigger: the parent records a short clip
    describing what to learn, the transcript becomes the description fed to
    /ingest/extract.
    """
    data = await audio.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty audio.",
        )

    # Browser MediaRecorder emits WebM/Opus; remux to OGG so the STT adapter
    # (which expects ogg/opus) accepts it.
    try:
        ogg_bytes = await webm_opus_to_ogg(data, sample_rate=16000)
    except Exception as e:
        log.exception("ingest transcribe — audio remux failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the audio clip.",
        ) from e

    try:
        result = await factory.stt.invoke(
            STTRequest(audio=ogg_bytes, audio_format="ogg", sample_rate=16000)
        )
    except Exception as e:
        log.exception("ingest transcribe — STT call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transcription failed; please try again.",
        ) from e

    return TranscribeResult(text=result.text.strip())
