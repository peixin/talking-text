"""Session CRUD endpoints + turn handling."""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.protocol import LLMMessage
from app.adapters.llm.volc import VolcLLMAdapter
from app.adapters.stt.volc import VolcSTTAdapter
from app.adapters.tts.volc import VolcTTSAdapter
from app.api.auth import get_current_account
from app.audio_codec import webm_opus_to_ogg
from app.config import settings
from app.core.dialog import DialogOrchestrator, EmptyTranscriptionError
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner
from app.storage.models.session import Session
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])

_llm = VolcLLMAdapter()
_stt = VolcSTTAdapter()
_tts = VolcTTSAdapter()
_orchestrator = DialogOrchestrator(stt=_stt, llm=_llm, tts=_tts)

_TITLE_PROMPT = (
    "You label English practice sessions for Chinese elementary school children. "
    "Given one conversation turn, output a SHORT title (≤ 8 Chinese characters). "
    "Output the title only — no punctuation, no explanation."
)


# ── Schemas ──────────────────────────────────────────────────────────────────


class SessionOut(BaseModel):
    id: uuid.UUID
    learner_id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateSessionBody(BaseModel):
    learner_id: uuid.UUID


class UpdateSessionBody(BaseModel):
    title: str


class TurnOut(BaseModel):
    id: uuid.UUID
    text_user: str
    text_ai: str
    has_audio_out: bool
    has_audio_in: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TurnResponse(BaseModel):
    turn_id: uuid.UUID
    text_user: str
    text_ai: str
    audio_b64: str
    audio_format: str
    session_title: str | None


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _require_learner(learner_id: uuid.UUID, account: Account, db: AsyncSession) -> Learner:
    row = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = row.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    return learner


async def _require_session(session_id: uuid.UUID, account: Account, db: AsyncSession) -> Session:
    row = await db.execute(
        select(Session)
        .join(Learner, Session.learner_id == Learner.id)
        .where(
            Session.id == session_id,
            Session.deleted.is_(False),
            Learner.account_id == account.id,
        )
    )
    session = row.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Session]:
    await _require_learner(learner_id, account, db)
    rows = await db.execute(
        select(Session)
        .where(Session.learner_id == learner_id, Session.deleted.is_(False))
        .order_by(Session.updated_at.desc())
    )
    return list(rows.scalars().all())


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Session:
    await _require_learner(body.learner_id, account, db)
    session = Session(learner_id=body.learner_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: uuid.UUID,
    body: UpdateSessionBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Session:
    session = await _require_session(session_id, account, db)
    session.title = body.title.strip() or None
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_session(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    session = await _require_session(session_id, account, db)
    session.deleted = True
    await db.commit()


@router.get("/{session_id}/turns", response_model=list[TurnOut])
async def get_session_turns(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TurnOut]:
    await _require_session(session_id, account, db)
    rows = await db.execute(
        select(Turn).where(Turn.session_id == session_id).order_by(Turn.sequence.asc())
    )
    return [
        TurnOut(
            id=t.id,
            text_user=t.text_user,
            text_ai=t.text_ai,
            has_audio_out=t.audio_out_path is not None,
            has_audio_in=t.audio_in_path is not None,
            created_at=t.created_at,
        )
        for t in rows.scalars().all()
    ]


@router.get("/{session_id}/turns/{turn_id}/audio")
async def get_turn_audio(
    session_id: uuid.UUID,
    turn_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    dir: str = "out",
) -> FileResponse:
    await _require_session(session_id, account, db)
    row = await db.execute(select(Turn).where(Turn.id == turn_id, Turn.session_id == session_id))
    turn = row.scalar_one_or_none()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")
    audio_path = turn.audio_in_path if dir == "in" else turn.audio_out_path
    if not audio_path:
        raise HTTPException(status_code=404, detail="Audio not found")
    path = Path(audio_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    ext = path.suffix.lstrip(".")
    media_type = "audio/mpeg" if ext == "mp3" else "audio/ogg"
    return FileResponse(path, media_type=media_type)


@router.post("/{session_id}/turns", response_model=TurnResponse)
async def create_turn(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    audio: Annotated[UploadFile, File()],
) -> TurnResponse:
    session = await _require_session(session_id, account, db)
    learner_id = session.learner_id

    # Read upload + transcode webm -> ogg/opus.
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    content_type = (audio.content_type or "").lower()
    if "webm" in content_type or (audio.filename and audio.filename.endswith(".webm")):
        try:
            audio_bytes = await webm_opus_to_ogg(
                audio_bytes, sample_rate=settings.volc_stt_sample_rate
            )
        except RuntimeError as e:
            log.exception("ffmpeg failed for upload from learner=%s", learner_id)
            raise HTTPException(status_code=500, detail=f"audio transcode failed: {e}") from e

    # Orchestrate the turn.
    try:
        result = await _orchestrator.single_turn(
            db=db,
            learner_id=learner_id,
            session_id=session_id,
            audio_in=audio_bytes,
            audio_in_format="ogg",
            audio_in_sample_rate=settings.volc_stt_sample_rate,
        )
    except EmptyTranscriptionError as e:
        raise HTTPException(status_code=422, detail="EMPTY_TRANSCRIPTION") from e

    # Touch session + generate title on first turn.
    session_title = await _after_turn(
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
        session_title=session_title,
    )


# ── Post-turn helpers ──────────────────────────────────────────────────────────


async def _after_turn(
    *,
    session_id: uuid.UUID,
    text_user: str,
    text_ai: str,
    db: AsyncSession,
) -> str | None:
    """Touch session updated_at, generate title after first turn, return current title."""
    row = await db.execute(select(Session).where(Session.id == session_id))
    session = row.scalar_one_or_none()
    if not session:
        return None

    session.updated_at = datetime.now(UTC)

    if session.title is None:
        count = await db.scalar(select(func.count()).where(Turn.session_id == session_id))
        if count == 1:
            try:
                resp = await _llm.invoke(
                    [
                        LLMMessage(role="system", content=_TITLE_PROMPT),
                        LLMMessage(
                            role="user",
                            content=f"Child: {text_user}\nAI: {text_ai}",
                        ),
                    ],
                    max_tokens=20,
                    temperature=0.3,
                )
                title = resp.text.strip()
                if title:
                    session.title = title
            except Exception:
                log.exception("Title generation failed for session=%s", session_id)

    await db.commit()
    return session.title
