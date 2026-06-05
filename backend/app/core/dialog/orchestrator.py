"""Single-turn conversation orchestrator.

End-to-end flow for one turn (V1, batch):

    voice input  -> STT -> text_user -> LLM -> text_ai -> TTS -> audio_out
    text input            -> text_user -> LLM -> text_ai
                                                          (TTS skipped; generated on demand)

The system prompt is built dynamically per turn via the Scope Computer and
Prompt Assembler — see ``core/scope/`` and ``core/prompt/``.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.protocol import LLMMessage, TextLLM
from app.adapters.storage.protocol import BlobStorage
from app.adapters.stt.protocol import AudioFormat as STTAudioFormat
from app.adapters.stt.protocol import STTAdapter, STTRequest
from app.adapters.tts.protocol import AudioFormat as TTSAudioFormat
from app.adapters.tts.protocol import TTSAdapter, TTSRequest
from app.app_config import app_config
from app.config import settings
from app.core.calibration import estimate_and_maybe_settle
from app.core.mastery import analyze_session, scan_turn_for_items
from app.core.prompt import _TINA_PERSONA, build_system_prompt
from app.core.scope import ScopeComputer
from app.storage.models.learner import Learner
from app.storage.models.session import Session
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)


# Holds strong references to fire-and-forget background tasks so the GC doesn't
# drop them mid-execution. asyncio.create_task only keeps a weak reference.
_background_tasks: set[asyncio.Task[None]] = set()


def _spawn_background(coro: object) -> None:
    task: asyncio.Task[None] = asyncio.create_task(coro)  # type: ignore[arg-type]
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@dataclass(frozen=True)
class TurnResult:
    turn_id: uuid.UUID
    text_user: str
    text_ai: str
    audio_out: bytes | None  # None when generate_audio=False
    audio_out_format: TTSAudioFormat | None  # None when generate_audio=False


class DialogOrchestrator:
    def __init__(
        self,
        *,
        stt: STTAdapter,
        llm: TextLLM,
        tts: TTSAdapter,
        scope: ScopeComputer,
        blob: BlobStorage,
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._scope = scope
        self._blob = blob

    async def _resolve_system_prompt(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> str:
        """Fetch session group binding and learner persona, then build the system prompt."""
        session_row = await db.execute(select(Session).where(Session.id == session_id))
        session = session_row.scalar_one_or_none()
        group_id = session.group_id if session else None

        learner_row = await db.execute(select(Learner).where(Learner.id == learner_id))
        learner = learner_row.scalar_one_or_none()
        learner_name = learner.name if learner else None
        persona_prompt = (learner.ai_persona_prompt if learner else None) or _TINA_PERSONA

        scope = await self._scope.get_scope(db, learner_id, group_id)
        return build_system_prompt(scope, persona_prompt=persona_prompt, learner_name=learner_name)

    async def _persist_audio(
        self,
        *,
        turn_id: uuid.UUID,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
        audio_in: bytes | None,
        audio_in_format: STTAudioFormat,
        audio_out: bytes | None,
        audio_out_format: TTSAudioFormat | None,
    ) -> tuple[str | None, str | None]:
        """Store turn audio via the blob backend and return storage keys.

        Returns ``(in_key, out_key)`` — relative keys persisted on the Turn row,
        not filesystem paths. ``None`` when there is nothing to store or
        persistence is disabled.
        """
        if not settings.audio_storage_enabled:
            return None, None

        in_key: str | None = None
        if audio_in is not None:
            in_ext = "ogg" if audio_in_format == "ogg" else audio_in_format
            in_key = audio_blob_key(learner_id, session_id, turn_id, "in", in_ext)
            await self._blob.put(in_key, audio_in, content_type=audio_media_type(in_ext))

        out_key: str | None = None
        if audio_out is not None and audio_out_format is not None:
            out_ext = "mp3" if audio_out_format == "mp3" else audio_out_format
            out_key = audio_blob_key(learner_id, session_id, turn_id, "out", out_ext)
            await self._blob.put(out_key, audio_out, content_type=audio_media_type(out_ext))

        return in_key, out_key

    async def single_turn(
        self,
        *,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
        # Exactly one of these must be provided:
        audio_in: bytes | None = None,  # OGG bytes from voice recording
        audio_in_format: STTAudioFormat = "ogg",
        audio_in_sample_rate: int = 16000,
        text_user: str | None = None,  # typed text from text input mode
        # Whether to run TTS on the AI response.
        # True for voice mode (so the caller can auto-play the reply).
        # False for text mode (audio generated on demand via get_turn_audio).
        generate_audio: bool = True,
        voice: str | None = None,
    ) -> TurnResult:
        t_total = time.monotonic()

        # 1. Resolve text_user from voice (STT) or direct text input.
        if text_user is not None:
            resolved_text_user = text_user.strip()
            stt_audio_seconds: float = 0.0
        elif audio_in is not None:
            t_stt = time.monotonic()
            stt_result = await self._stt.invoke(
                STTRequest(
                    audio=audio_in,
                    audio_format=audio_in_format,
                    sample_rate=audio_in_sample_rate,
                )
            )
            if app_config.debug.perf_logging:
                log.info(
                    "[perf] STT: %.3fs (audio_bytes=%d)", time.monotonic() - t_stt, len(audio_in)
                )
            resolved_text_user = stt_result.text.strip()
            stt_audio_seconds = stt_result.audio_seconds
            if not resolved_text_user:
                raise EmptyTranscriptionError(
                    "STT returned empty text. The child may not have spoken loudly enough."
                )
        else:
            raise ValueError("Exactly one of audio_in or text_user must be provided")

        # 2. Load session history and call LLM.
        t_llm = time.monotonic()
        history_rows = await db.execute(
            select(Turn.text_user, Turn.text_ai)
            .where(Turn.session_id == session_id)
            .order_by(Turn.sequence.asc())
        )
        system_prompt = await self._resolve_system_prompt(db, learner_id, session_id)
        messages: list[LLMMessage] = [LLMMessage(role="system", content=system_prompt)]
        for row in history_rows:
            messages.append(LLMMessage(role="user", content=row.text_user))
            messages.append(LLMMessage(role="assistant", content=row.text_ai))
        messages.append(LLMMessage(role="user", content=resolved_text_user))
        if app_config.debug.perf_logging:
            log.info(
                "[chat] messages sent to LLM (%d):\n%s",
                len(messages),
                "\n---\n".join(f"[{m.role}] {m.content}" for m in messages),
            )
        dialog = app_config.task("dialog")
        llm_response = await self._llm.invoke(
            messages, max_tokens=dialog.max_tokens, temperature=dialog.temperature
        )
        text_ai = llm_response.text.strip()
        if app_config.debug.perf_logging:
            log.info(
                "[perf] LLM: %.3fs (in_tokens=%d, out_tokens=%d)",
                time.monotonic() - t_llm,
                llm_response.input_tokens,
                llm_response.output_tokens,
            )

        # 3. TTS — only in voice mode (text mode generates on demand via get_turn_audio).
        audio_out: bytes | None = None
        audio_out_format: TTSAudioFormat | None = None
        tts_chars: int = 0

        if generate_audio:
            t_tts = time.monotonic()
            tts_voice = voice or settings.volc_tts_default_voice
            tts_fmt: TTSAudioFormat = settings.volc_tts_audio_format  # type: ignore[assignment]
            tts_result = await self._tts.invoke(
                TTSRequest(
                    text=text_ai,
                    voice=tts_voice,
                    audio_format=tts_fmt,
                    sample_rate=settings.volc_tts_sample_rate,
                )
            )
            audio_out = tts_result.audio
            audio_out_format = tts_result.audio_format
            tts_chars = tts_result.chars
            if app_config.debug.perf_logging:
                log.info("[perf] TTS: %.3fs (chars=%d)", time.monotonic() - t_tts, tts_chars)

        # 4. Persist turn.
        t_db = time.monotonic()
        seq_result = await db.execute(
            select(func.coalesce(func.max(Turn.sequence), 0)).where(Turn.session_id == session_id)
        )
        next_sequence: int = seq_result.scalar_one() + 1

        turn_id = uuid.uuid4()
        audio_in_path, audio_out_path = await self._persist_audio(
            turn_id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            audio_in=audio_in,
            audio_in_format=audio_in_format,
            audio_out=audio_out,
            audio_out_format=audio_out_format,
        )

        turn = Turn(
            id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            sequence=next_sequence,
            text_user=resolved_text_user,
            text_ai=text_ai,
            audio_in_path=audio_in_path,
            audio_out_path=audio_out_path,
            stt_audio_seconds=stt_audio_seconds,
            llm_input_tokens=llm_response.input_tokens,
            llm_output_tokens=llm_response.output_tokens,
            tts_chars=tts_chars,
        )
        db.add(turn)
        await db.commit()
        if app_config.debug.perf_logging:
            log.info("[perf] DB persist: %.3fs", time.monotonic() - t_db)

        # Background tasks — none of these block the chat reply.
        if resolved_text_user:
            # Calibration: estimate the learner's level until settled.
            _spawn_background(
                estimate_and_maybe_settle(
                    learner_id=learner_id,
                    session_id=session_id,
                    turn_sequence=next_sequence,
                    learner_text=resolved_text_user,
                )
            )
            # Mastery anchor-scan: tick seen_count for any in-scope items the
            # learner just produced. No-op if the session has no group.
            _spawn_background(
                scan_turn_for_items(
                    learner_id=learner_id,
                    session_id=session_id,
                    text_user=resolved_text_user,
                )
            )
        # Session-end mastery analysis: fire once when we cross the soft limit.
        if next_sequence == app_config.session.max_turns:
            _spawn_background(analyze_session(learner_id=learner_id, session_id=session_id))

        if app_config.debug.perf_logging:
            log.info("[perf] orchestrator TOTAL: %.3fs", time.monotonic() - t_total)
        return TurnResult(
            turn_id=turn_id,
            text_user=resolved_text_user,
            text_ai=text_ai,
            audio_out=audio_out,
            audio_out_format=audio_out_format,
        )

    async def initiate_session(
        self,
        *,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> None:
        """Automatically generate an AI greeting for a new session."""
        system_prompt = await self._resolve_system_prompt(db, learner_id, session_id)

        session_row = await db.execute(select(Session).where(Session.id == session_id))
        session = session_row.scalar_one()

        if session.group_id:
            greeting_instruction = (
                "Please say a brief, friendly hello to the child. "
                "Mention that we are going to practice the words and sentences for today's lesson, "
                "and ask a simple, engaging question to start the conversation."
            )
        else:
            greeting_instruction = (
                "Please say a brief, friendly hello to the child. "
                "Since no specific lesson is selected today, "
                "ask them what they would like to talk about, "
                "or suggest a fun topic to start the conversation."
            )

        messages = [
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=f"(System instruction: {greeting_instruction})"),
        ]

        greeting = app_config.task("greeting")
        llm_response = await self._llm.invoke(
            messages, max_tokens=greeting.max_tokens, temperature=greeting.temperature
        )
        text_ai = llm_response.text.strip()

        turn_id = uuid.uuid4()
        turn = Turn(
            id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            sequence=1,
            text_user="",  # Empty text_user means it's an AI-initiated turn
            text_ai=text_ai,
            audio_in_path=None,
            audio_out_path=None,
            stt_audio_seconds=0.0,
            llm_input_tokens=llm_response.input_tokens,
            llm_output_tokens=llm_response.output_tokens,
            tts_chars=0,
        )
        db.add(turn)
        await db.commit()

    async def stream_turn(
        self,
        *,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
        audio_in: bytes | None = None,
        audio_in_format: STTAudioFormat = "ogg",
        audio_in_sample_rate: int = 16000,
        text_user: str | None = None,
        generate_audio: bool = True,
        voice: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        return self._stream_turn_impl(
            db=db,
            learner_id=learner_id,
            session_id=session_id,
            audio_in=audio_in,
            audio_in_format=audio_in_format,
            audio_in_sample_rate=audio_in_sample_rate,
            text_user=text_user,
            generate_audio=generate_audio,
            voice=voice,
        )

    async def _stream_turn_impl(
        self,
        *,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
        audio_in: bytes | None,
        audio_in_format: STTAudioFormat,
        audio_in_sample_rate: int,
        text_user: str | None,
        generate_audio: bool,
        voice: str | None,
    ) -> AsyncGenerator[dict, None]:
        t_total = time.monotonic()

        # 1. Resolve text_user from STT or direct input.
        stt_audio_seconds: float = 0.0
        if text_user is not None:
            resolved_text_user = text_user.strip()
        elif audio_in is not None:
            t_stt = time.monotonic()
            stt_result = await self._stt.invoke(
                STTRequest(
                    audio=audio_in,
                    audio_format=audio_in_format,
                    sample_rate=audio_in_sample_rate,
                )
            )
            if app_config.debug.perf_logging:
                log.info(
                    "[perf] STT: %.3fs (audio_bytes=%d)", time.monotonic() - t_stt, len(audio_in)
                )
            resolved_text_user = stt_result.text.strip()
            stt_audio_seconds = stt_result.audio_seconds
            if not resolved_text_user:
                yield {"event": "error", "code": "EMPTY_TRANSCRIPTION"}
                return
        else:
            raise ValueError("Exactly one of audio_in or text_user must be provided")

        yield {"event": "text_user", "text": resolved_text_user}

        # 2. Load history and stream LLM.
        t_llm = time.monotonic()
        history_rows = await db.execute(
            select(Turn.text_user, Turn.text_ai)
            .where(Turn.session_id == session_id)
            .order_by(Turn.sequence.asc())
        )
        system_prompt = await self._resolve_system_prompt(db, learner_id, session_id)
        messages: list[LLMMessage] = [LLMMessage(role="system", content=system_prompt)]
        for row in history_rows:
            messages.append(LLMMessage(role="user", content=row.text_user))
            messages.append(LLMMessage(role="assistant", content=row.text_ai))
        messages.append(LLMMessage(role="user", content=resolved_text_user))
        if app_config.debug.perf_logging:
            log.info(
                "[chat] messages sent to LLM (%d):\n%s",
                len(messages),
                "\n---\n".join(f"[{m.role}] {m.content}" for m in messages),
            )

        text_ai = ""
        dialog = app_config.task("dialog")
        async for delta in self._llm.stream(
            messages, max_tokens=dialog.max_tokens, temperature=dialog.temperature
        ):
            text_ai += delta
            yield {"event": "text_ai_delta", "delta": delta}
        text_ai = text_ai.strip()

        if app_config.debug.perf_logging:
            log.info("[perf] LLM stream: %.3fs", time.monotonic() - t_llm)

        # 3. Persist turn (audio_out_path=None; TTS audio served on-demand via get_turn_audio).
        t_db = time.monotonic()
        seq_result = await db.execute(
            select(func.coalesce(func.max(Turn.sequence), 0)).where(Turn.session_id == session_id)
        )
        next_sequence: int = seq_result.scalar_one() + 1
        turn_id = uuid.uuid4()

        audio_in_path, _ = await self._persist_audio(
            turn_id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            audio_in=audio_in,
            audio_in_format=audio_in_format,
            audio_out=None,
            audio_out_format=None,
        )

        turn = Turn(
            id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            sequence=next_sequence,
            text_user=resolved_text_user,
            text_ai=text_ai,
            audio_in_path=audio_in_path,
            audio_out_path=None,
            stt_audio_seconds=stt_audio_seconds,
            llm_input_tokens=0,
            llm_output_tokens=0,
            tts_chars=0,
        )
        db.add(turn)
        await db.commit()

        if app_config.debug.perf_logging:
            log.info("[perf] DB persist: %.3fs", time.monotonic() - t_db)

        # Background tasks — none of these block the chat reply.
        if resolved_text_user:
            # Calibration: estimate the learner's level until settled.
            _spawn_background(
                estimate_and_maybe_settle(
                    learner_id=learner_id,
                    session_id=session_id,
                    turn_sequence=next_sequence,
                    learner_text=resolved_text_user,
                )
            )
            # Mastery anchor-scan: tick seen_count for any in-scope items the
            # learner just produced. No-op if the session has no group.
            _spawn_background(
                scan_turn_for_items(
                    learner_id=learner_id,
                    session_id=session_id,
                    text_user=resolved_text_user,
                )
            )
        # Session-end mastery analysis: fire once when we cross the soft limit.
        if next_sequence == app_config.session.max_turns:
            _spawn_background(analyze_session(learner_id=learner_id, session_id=session_id))

        # turn is now in DB — safe to surface the turn_id to the client.
        yield {
            "event": "text_ai_done",
            "turn_id": str(turn_id),
            "text_user": resolved_text_user,
            "text_ai": text_ai,
        }

        # 4. TTS for voice mode (inline audio for auto-play; audio_out_path stays null;
        #    subsequent play-button clicks use get_turn_audio on-demand generation).
        if generate_audio:
            t_tts = time.monotonic()
            tts_voice = voice or settings.volc_tts_default_voice
            tts_fmt: TTSAudioFormat = settings.volc_tts_audio_format  # type: ignore[assignment]
            tts_result = await self._tts.invoke(
                TTSRequest(
                    text=text_ai,
                    voice=tts_voice,
                    audio_format=tts_fmt,
                    sample_rate=settings.volc_tts_sample_rate,
                )
            )
            if app_config.debug.perf_logging:
                log.info("[perf] TTS: %.3fs (chars=%d)", time.monotonic() - t_tts, tts_result.chars)
            audio_b64 = base64.b64encode(tts_result.audio).decode("ascii")
            yield {
                "event": "audio_ready",
                "audio_b64": audio_b64,
                "audio_format": str(tts_result.audio_format),
            }

        if app_config.debug.perf_logging:
            log.info("[perf] stream_turn TOTAL: %.3fs", time.monotonic() - t_total)


class EmptyTranscriptionError(RuntimeError):
    """Raised when STT returns empty text — typically silent / too-quiet audio."""


def audio_blob_key(
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    turn_id: uuid.UUID,
    direction: str,  # "in" | "out"
    ext: str,  # "ogg" | "mp3"
) -> str:
    """The canonical storage key for one turn's audio — backend-independent."""
    return f"{learner_id}/{session_id}/{turn_id}_{direction}.{ext}"


def audio_media_type(key_or_ext: str) -> str:
    """HTTP media type inferred from a key or extension."""
    return "audio/mpeg" if key_or_ext.endswith("mp3") else "audio/ogg"
