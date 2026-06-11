"""Session CRUD endpoints + turn handling."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.factory import blob as _blob
from app.adapters.factory import chat as _chat
from app.adapters.factory import orchestrator as _orchestrator
from app.adapters.factory import tts as _tts
from app.adapters.llm.protocol import LLMMessage
from app.adapters.tts.protocol import TTSRequest
from app.api.auth import get_current_account
from app.app_config import app_config
from app.audio_codec import webm_opus_to_ogg
from app.config import settings
from app.core.dialog import EmptyTranscriptionError
from app.core.dialog.orchestrator import audio_blob_key, audio_media_type
from app.model_registry import model_registry
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
    group_id: uuid.UUID | None
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateSessionBody(BaseModel):
    learner_id: uuid.UUID
    group_id: uuid.UUID | None = None


class UpdateSessionBody(BaseModel):
    title: str | None = None
    group_id: uuid.UUID | None = None


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
    session_status: str  # "active" | "soft_limit"


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


async def _check_session_limits(session_id: uuid.UUID, db: AsyncSession) -> int:
    """Return current turn count; raise HTTP 422 SESSION_HARD_LIMIT if context is exhausted.

    Uses the maximum llm_input_tokens seen in the session as a proxy for current context
    size — the most-recent turn's input includes the full accumulated history, so it
    grows monotonically and is the best signal we have without a separate token counter.
    """
    row = await db.execute(
        select(
            func.count(Turn.id),
            func.coalesce(func.max(Turn.llm_input_tokens), 0),
        ).where(Turn.session_id == session_id)
    )
    turn_count, max_input_tokens = row.one()
    chat = app_config.adapter.chat
    context_window = model_registry.context_limit(chat.provider, chat.model)
    context_ceiling = int(app_config.session.context_hard_limit * context_window)
    if max_input_tokens > context_ceiling:
        raise HTTPException(status_code=422, detail="SESSION_HARD_LIMIT")
    return int(turn_count)


def _session_status(turn_count_after: int) -> str:
    return "soft_limit" if turn_count_after >= app_config.session.max_turns else "active"


async def _read_turn_input(
    audio: UploadFile | None, text: str | None, learner_id: uuid.UUID
) -> tuple[bytes | None, str]:
    """Validate and normalize turn input (shared by batch and streaming endpoints).

    Returns (audio_bytes, text_stripped) — audio_bytes is transcoded to ogg/opus
    when the browser sent webm. Raises HTTPException on empty/oversized input.
    """
    limits = app_config.limits
    text_stripped = (text or "").strip()
    if len(text_stripped) > limits.chat_text_max_chars:
        raise HTTPException(status_code=422, detail="TEXT_TOO_LONG")

    audio_bytes: bytes | None = None
    if audio is not None:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="audio file is empty")
        if len(audio_bytes) > limits.audio_upload_max_bytes:
            raise HTTPException(status_code=422, detail="AUDIO_TOO_LARGE")
        content_type = (audio.content_type or "").lower()
        if "webm" in content_type or (audio.filename or "").endswith(".webm"):
            t_transcode = time.monotonic()
            try:
                audio_bytes = await webm_opus_to_ogg(
                    audio_bytes, sample_rate=settings.volc_stt_sample_rate
                )
            except RuntimeError as e:
                log.exception("ffmpeg transcode failed for learner=%s", learner_id)
                raise HTTPException(status_code=500, detail=f"audio transcode failed: {e}") from e
            if app_config.debug.perf_logging:
                log.info(
                    "[perf] transcode webm->ogg: %.3fs (%d bytes out)",
                    time.monotonic() - t_transcode,
                    len(audio_bytes),
                )
    elif not text_stripped:
        raise HTTPException(status_code=400, detail="Provide either an audio file or text")

    return audio_bytes, text_stripped


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
    session = Session(learner_id=body.learner_id, group_id=body.group_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Initiate the session with an AI greeting turn
    try:
        await _orchestrator.initiate_session(
            db=db,
            learner_id=body.learner_id,
            session_id=session.id,
        )
    except Exception:
        log.exception("Failed to initiate session greeting for session=%s", session.id)

    return session


@router.patch("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: uuid.UUID,
    body: UpdateSessionBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Session:
    session = await _require_session(session_id, account, db)
    if body.title is not None:
        session.title = body.title.strip() or None
    if body.group_id is not None:
        session.group_id = body.group_id
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

    Serves the stored object when available. When not available (text-mode turns
    or storage disabled), generates TTS on demand and optionally stores the
    result so subsequent requests are a cache hit.

    The Turn row holds a backend-independent storage *key*, never a path. Cloud
    backends return a signed URL (we redirect there); the local backend returns
    bytes that we serve through this authenticated endpoint.
    """
    await _require_session(session_id, account, db)
    row = await db.execute(select(Turn).where(Turn.id == turn_id, Turn.session_id == session_id))
    turn = row.scalar_one_or_none()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")

    served = await _serve_stored_audio(turn.audio_in_path if dir == "in" else turn.audio_out_path)
    if served is not None:
        return served

    # Generate TTS on demand — serialised per (turn_id, dir) to avoid duplicate
    # API calls when multiple tabs request the same missing audio simultaneously.
    async with _scoped_lock(_tts_gen_locks, f"{turn_id}:{dir}"):
        # Double-check: another waiter may have generated and stored the object.
        await db.refresh(turn)
        served = await _serve_stored_audio(
            turn.audio_in_path if dir == "in" else turn.audio_out_path
        )
        if served is not None:
            return served

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

        # Store and update the turn record so the next request is a cache hit.
        if settings.audio_storage_enabled:
            ext = "mp3" if tts_fmt == "mp3" else tts_fmt
            key = audio_blob_key(turn.learner_id, session_id, turn_id, dir, ext)
            await _blob.put(key, tts_result.audio, content_type=audio_media_type(ext))
            if dir == "in":
                turn.audio_in_path = key
            else:
                turn.audio_out_path = key
            await db.commit()

    return Response(content=tts_result.audio, media_type=audio_media_type(tts_fmt))


async def _serve_stored_audio(key: str | None) -> Response | None:
    """Return a Response for a stored audio key, or None if there is nothing stored.

    Redirects to a signed URL when the backend provides one (cloud); otherwise
    streams the bytes back through this endpoint (local).
    """
    if not key:
        return None
    signed = await _blob.url(key)
    if signed:
        return RedirectResponse(signed)
    data = await _blob.get(key)
    if data is None:
        return None
    return Response(content=data, media_type=audio_media_type(key))


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
    t_req = time.monotonic()
    session = await _require_session(session_id, account, db)
    learner_id = session.learner_id

    # Read the audio bytes before acquiring the lock (I/O outside critical section).
    audio_bytes, text_stripped = await _read_turn_input(audio, text, learner_id)

    # Serialise turn creation per session: guarantees sequential history and
    # prevents duplicate turns from network retries that arrive concurrently.
    turn_count_before: int = 0
    async with _scoped_lock(_session_turn_locks, str(session_id)):
        turn_count_before = await _check_session_limits(session_id, db)
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

    if app_config.debug.perf_logging:
        log.info("[perf] create_turn TOTAL: %.3fs", time.monotonic() - t_req)
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
        session_status=_session_status(turn_count_before + 1),
    )


@router.post("/{session_id}/turns/stream")
async def stream_turn(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    audio: Annotated[UploadFile | None, File()] = None,
    text: Annotated[str | None, Form()] = None,
) -> StreamingResponse:
    """Streaming turn: returns SSE events as the pipeline progresses.

    Events (all JSON in `data:` field):
      text_user       — transcription ready (voice) or input echo (text)
      text_ai_delta   — one LLM token
      text_ai_done    — LLM complete; turn committed to DB; includes turn_id
      audio_ready     — TTS done (voice mode only); includes audio_b64
      done            — pipeline complete; includes session_title
      error           — with `code` field (e.g. EMPTY_TRANSCRIPTION)
    """
    t_req = time.monotonic()
    session = await _require_session(session_id, account, db)
    learner_id = session.learner_id

    audio_bytes, text_stripped = await _read_turn_input(audio, text, learner_id)

    # Check session limits before committing to the stream (can still raise HTTPException here).
    turn_count_pre = await _check_session_limits(session_id, db)

    async def generate() -> AsyncIterator[str]:
        text_user_cap: str | None = None
        text_ai_cap: str | None = None

        async with _scoped_lock(_session_turn_locks, str(session_id)):
            async for event in await _orchestrator.stream_turn(
                db=db,
                learner_id=learner_id,
                session_id=session_id,
                audio_in=audio_bytes,
                audio_in_format="ogg" if audio_bytes is not None else "ogg",
                audio_in_sample_rate=settings.volc_stt_sample_rate,
                text_user=text_stripped or None,
                generate_audio=audio_bytes is not None,
            ):
                if event.get("event") == "text_ai_done":
                    text_user_cap = event.get("text_user")
                    text_ai_cap = event.get("text_ai")
                elif event.get("event") == "error":
                    yield f"data: {json.dumps(event)}\n\n"
                    return
                yield f"data: {json.dumps(event)}\n\n"

        # _after_turn runs outside the per-session lock.
        session_title: str | None = None
        if text_user_cap and text_ai_cap:
            session_title = await _after_turn(
                session_id=session_id,
                text_user=text_user_cap,
                text_ai=text_ai_cap,
                db=db,
            )

        if app_config.debug.perf_logging:
            log.info("[perf] stream_turn endpoint TOTAL: %.3fs", time.monotonic() - t_req)

        yield f"data: {json.dumps({
            'event': 'done',
            'session_title': session_title,
            'session_status': _session_status(turn_count_pre + 1)
        })}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
        if count == 2:
            try:
                title_task = app_config.task("title")
                resp = await _chat.invoke(
                    [
                        LLMMessage(role="system", content=_TITLE_PROMPT),
                        LLMMessage(
                            role="user",
                            content=f"Child: {text_user}\nAI: {text_ai}",
                        ),
                    ],
                    max_tokens=title_task.max_tokens,
                    temperature=title_task.temperature,
                )
                title = resp.text.strip()
                if title:
                    session.title = title
            except Exception:
                log.exception("Title generation failed for session=%s", session_id)

    await db.commit()
    return session.title
