"""POST /conversation/turn — one round of voice chat.

Request: multipart/form-data
    audio: UploadFile (browser-recorded webm/opus by default; we re-mux to ogg)
    learner_id: uuid (must belong to the authenticated account)
    history: optional JSON array of {"role": "user"|"assistant", "text": "..."}

Response: JSON
    {
      "turn_id": "...",
      "text_user": "...",
      "text_ai": "...",
      "audio_b64": "<base64 mp3>",
      "audio_format": "mp3"
    }

The audio is delivered in-line as base64 so the browser can play it via a
``data:`` URL — no second roundtrip in V1. When we add long-form review for
parents, we'll add a separate ``GET /conversation/audio/{id}`` that serves
from disk (or TOS).
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.volc import VolcLLMAdapter
from app.adapters.stt.volc import VolcSTTAdapter
from app.adapters.tts.volc import VolcTTSAdapter
from app.api.auth import get_current_account
from app.api.session import after_turn
from app.audio_codec import webm_opus_to_ogg
from app.config import settings
from app.core.dialog import DialogOrchestrator, EmptyTranscriptionError, HistoryMessage
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner
from app.storage.models.session import Session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/conversation", tags=["conversation"])


# Module-level singletons. Each adapter is a thin stateless wrapper around an
# async client, so sharing one instance across requests is safe and avoids
# reconnecting / re-handshaking per turn.
_llm = VolcLLMAdapter()
_stt = VolcSTTAdapter()
_tts = VolcTTSAdapter()
_orchestrator = DialogOrchestrator(stt=_stt, llm=_llm, tts=_tts)


class HistoryItem(BaseModel):
    role: str
    text: str


class TurnResponse(BaseModel):
    turn_id: uuid.UUID
    text_user: str
    text_ai: str
    audio_b64: str
    audio_format: str


@router.post("/turn", status_code=status.HTTP_200_OK)
async def conversation_turn(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    learner_id: Annotated[uuid.UUID, Form()],
    session_id: Annotated[uuid.UUID, Form()],
    audio: Annotated[UploadFile, File()],
    history: Annotated[str | None, Form()] = None,
) -> TurnResponse:
    # 1. Validate learner belongs to the authenticated account.
    learner_row = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = learner_row.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    # 1b. Validate session belongs to the learner.
    session_row = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.learner_id == learner_id,
            Session.deleted.is_(False),
        )
    )
    if not session_row.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. Parse optional history.
    parsed_history: list[HistoryMessage] = []
    if history:
        try:
            raw = json.loads(history)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"history is not valid JSON: {e}") from e
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="history must be a JSON array")
        for item in raw:
            try:
                msg = HistoryItem.model_validate(item)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"invalid history item: {e}") from e
            parsed_history.append(HistoryMessage(role=msg.role, text=msg.text))

    # 3. Read upload + transcode webm -> ogg/opus.
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    content_type = (audio.content_type or "").lower()
    if "webm" in content_type or audio.filename and audio.filename.endswith(".webm"):
        try:
            audio_bytes = await webm_opus_to_ogg(
                audio_bytes, sample_rate=settings.volc_stt_sample_rate
            )
        except RuntimeError as e:
            log.exception("ffmpeg failed for upload from learner=%s", learner_id)
            raise HTTPException(status_code=500, detail=f"audio transcode failed: {e}") from e

    # 4. Orchestrate the turn.
    try:
        result = await _orchestrator.single_turn(
            db=db,
            learner_id=learner_id,
            session_id=session_id,
            audio_in=audio_bytes,
            audio_in_format="ogg",
            audio_in_sample_rate=settings.volc_stt_sample_rate,
            recent_history=parsed_history,
        )
    except EmptyTranscriptionError as e:
        raise HTTPException(status_code=422, detail="EMPTY_TRANSCRIPTION") from e

    # 5. Touch session updated_at and generate title on first turn.
    await after_turn(
        session_id=session_id,
        text_user=result.text_user,
        text_ai=result.text_ai,
        db=db,
    )

    return TurnResponse(
        turn_id=result.turn_id,
        text_user=result.text_user,
        text_ai=result.text_ai,
        audio_b64=base64.b64encode(result.audio_out).decode("ascii"),
        audio_format=result.audio_out_format,
    )
