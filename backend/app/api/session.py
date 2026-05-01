"""Session CRUD endpoints + turn handling."""

from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.factory import llm as _llm
from app.adapters.factory import orchestrator as _orchestrator
from app.adapters.factory import tts as _tts
from app.adapters.llm.protocol import LLMMessage
from app.adapters.tts.protocol import TTSRequest
from app.api.auth import get_current_account
from app.audio_codec import webm_opus_to_ogg
from app.config import settings
from app.core.dialog import EmptyTranscriptionError
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner
from app.storage.models.session import Session
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])

# ── In-process concurrency guards (single-process; sufficient for V1) ─────────
#
# _tts_gen_locks      — one asyncio.Lock per (turn_id, dir).
#                       Prevents concurrent TTS generation for the same slot.
# _session_turn_locks — one asyncio.Lock per session_id.
#                       Serialises turn creation so LLM history is consistent.
#
# Both dicts are pruned immediately after each use: once a lock is released and
# no other coroutine is waiting on it, the entry is deleted. This keeps memory
# bounded regardless of how long the server runs.
#
# Safety note: asyncio is single-threaded. There is no await between the
# lock.locked() check and dict.pop(), so the check-then-delete is atomic from
# the event-loop's perspective.

_tts_gen_locks: dict[str, asyncio.Lock] = {}
_session_turn_locks: dict[str, asyncio.Lock] = {}


@asynccontextmanager
async def _scoped_lock(lock_dict: dict[str, asyncio.Lock], key: str) -> AsyncIterator[None]:
    """Acquire (or create) a named lock, then prune it when no longer needed."""
    if key not in lock_dict:
        lock_dict[key] = asyncio.Lock()
    lock = lock_dict[key]
    async with lock:
        yield
    # Prune: if no other waiter is queued, remove the entry so memory stays bounded.
    # Waiters already hold a direct reference to `lock`, so deleting the dict entry
    # does not affect them — they will still acquire and release the same object.
    if lock_dict.get(key) is lock and not lock.locked():
        lock_dict.pop(key, None)


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
    created_at: datetime

    model_config = {"from_attributes": True}


class TurnResponse(BaseModel):
    turn_id: uuid.UUID
    text_user: str
    text_ai: str
    audio_b64: str | None  # present only in voice mode
    audio_format: str | None  # present only in voice mode
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
) -> list[Turn]:
    await _require_session(session_id, account, db)
    rows = await db.execute(
        select(Turn).where(Turn.session_id == session_id).order_by(Turn.sequence.asc())
    )
    return list(rows.scalars().all())


@router.get("/{session_id}/turns/{turn_id}/audio")
async def get_turn_audio(
    session_id: uuid.UUID,
    turn_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    dir: str = "out",
) -> Response:
    """Return audio for a turn direction.

    Serves the stored file when available. When not available (text-mode turns
    or storage disabled), generates TTS on demand and optionally saves the
    result so subsequent requests are served from disk.
    """
    await _require_session(session_id, account, db)
    row = await db.execute(select(Turn).where(Turn.id == turn_id, Turn.session_id == session_id))
    turn = row.scalar_one_or_none()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")

    stored_path = turn.audio_in_path if dir == "in" else turn.audio_out_path
    if stored_path:
        p = Path(stored_path)
        if p.exists():
            media_type = "audio/mpeg" if p.suffix == ".mp3" else "audio/ogg"
            return FileResponse(p, media_type=media_type)

    # Generate TTS on demand — serialised per (turn_id, dir) to avoid duplicate
    # API calls when multiple tabs request the same missing audio simultaneously.
    async with _scoped_lock(_tts_gen_locks, f"{turn_id}:{dir}"):
        # Double-check: another waiter may have generated and saved the file.
        await db.refresh(turn)
        stored_path = turn.audio_in_path if dir == "in" else turn.audio_out_path
        if stored_path:
            p = Path(stored_path)
            if p.exists():
                media_type = "audio/mpeg" if p.suffix == ".mp3" else "audio/ogg"
                return FileResponse(p, media_type=media_type)

        text = turn.text_user if dir == "in" else turn.text_ai
        tts_fmt: str = settings.volc_tts_audio_format
        tts_result = await _tts.invoke(
            TTSRequest(
                text=text,
                voice=settings.volc_tts_default_voice,
                audio_format=tts_fmt,  # type: ignore[arg-type]
                sample_rate=settings.volc_tts_sample_rate,
            )
        )

        # Save to disk and update the turn record so next request is a cache hit.
        if settings.audio_storage_enabled:
            base = Path(settings.audio_storage_dir) / str(turn.learner_id) / str(session_id)
            base.mkdir(parents=True, exist_ok=True)
            ext = "mp3" if tts_fmt == "mp3" else tts_fmt
            audio_file = base / f"{turn_id}_{dir}.{ext}"
            audio_file.write_bytes(tts_result.audio)
            if dir == "in":
                turn.audio_in_path = str(audio_file)
            else:
                turn.audio_out_path = str(audio_file)
            await db.commit()

    media_type = "audio/mpeg" if tts_fmt == "mp3" else "audio/ogg"
    return Response(content=tts_result.audio, media_type=media_type)


@router.post("/{session_id}/turns", response_model=TurnResponse)
async def create_turn(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    audio: Annotated[UploadFile | None, File()] = None,
    text: Annotated[str | None, Form()] = None,
) -> TurnResponse:
    """Create a turn from voice (audio file) or text input.

    Voice mode: STT -> LLM -> TTS. Returns audio_b64 for immediate playback.
    Text mode:  text -> LLM.        Returns audio_b64=null; audio generated
                                    on demand via GET …/audio.
    """
    session = await _require_session(session_id, account, db)
    learner_id = session.learner_id

    text_stripped = (text or "").strip()

    # Read the audio bytes before acquiring the lock (I/O outside critical section).
    audio_bytes: bytes | None = None
    if audio is not None:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="audio file is empty")
        content_type = (audio.content_type or "").lower()
        if "webm" in content_type or (audio.filename or "").endswith(".webm"):
            try:
                audio_bytes = await webm_opus_to_ogg(
                    audio_bytes, sample_rate=settings.volc_stt_sample_rate
                )
            except RuntimeError as e:
                log.exception("ffmpeg transcode failed for learner=%s", learner_id)
                raise HTTPException(status_code=500, detail=f"audio transcode failed: {e}") from e
    elif not text_stripped:
        raise HTTPException(status_code=400, detail="Provide either an audio file or text")

    # Serialise turn creation per session: guarantees sequential history and
    # prevents duplicate turns from network retries that arrive concurrently.
    async with _scoped_lock(_session_turn_locks, str(session_id)):
        try:
            if audio_bytes is not None:
                result = await _orchestrator.single_turn(
                    db=db,
                    learner_id=learner_id,
                    session_id=session_id,
                    audio_in=audio_bytes,
                    audio_in_format="ogg",
                    audio_in_sample_rate=settings.volc_stt_sample_rate,
                    generate_audio=True,
                )
            else:
                result = await _orchestrator.single_turn(
                    db=db,
                    learner_id=learner_id,
                    session_id=session_id,
                    text_user=text_stripped,
                    generate_audio=False,
                )
        except EmptyTranscriptionError as e:
            raise HTTPException(status_code=422, detail="EMPTY_TRANSCRIPTION") from e

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
        audio_b64=(
            base64.b64encode(result.audio_out).decode("ascii")
            if result.audio_out is not None
            else None
        ),
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
