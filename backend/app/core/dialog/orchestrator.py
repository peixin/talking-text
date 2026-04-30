"""Single-turn conversation orchestrator.

End-to-end flow for one turn (V1, batch):

    audio bytes
        -> STT       -> text_user
        -> LLM       -> text_ai
        -> TTS       -> audio bytes
        -> persist Turn
        -> return TurnResult

Scope Computer is intentionally not wired in V1 — see CLAUDE.md architecture
rule #2. The system prompt below carries the role definition manually until
``core/scope/`` and ``core/prompt/`` ship in V2.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.protocol import LLMAdapter, LLMMessage
from app.adapters.stt.protocol import AudioFormat as STTAudioFormat
from app.adapters.stt.protocol import STTAdapter, STTRequest
from app.adapters.tts.protocol import AudioFormat as TTSAudioFormat
from app.adapters.tts.protocol import TTSAdapter, TTSRequest
from app.config import settings
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)


_SYSTEM_PROMPT = (
    "You are Tina, a warm and patient English teacher chatting with an "
    "elementary-school child in mainland China. Always respond in English. "
    "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). "
    "If the child speaks Chinese, gently re-phrase their idea in English and "
    "invite them to repeat it. Stay encouraging; never correct mistakes "
    "harshly. Each turn, ask exactly one short follow-up question to keep "
    "the conversation going."
)


@dataclass(frozen=True)
class TurnResult:
    turn_id: uuid.UUID
    text_user: str
    text_ai: str
    audio_out: bytes
    audio_out_format: TTSAudioFormat
    sample_rate: int


class DialogOrchestrator:
    def __init__(
        self,
        *,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts

    async def single_turn(
        self,
        *,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
        audio_in: bytes,
        audio_in_format: STTAudioFormat,
        audio_in_sample_rate: int,
        voice: str | None = None,
    ) -> TurnResult:
        # 1. STT
        stt_result = await self._stt.invoke(
            STTRequest(
                audio=audio_in,
                audio_format=audio_in_format,
                sample_rate=audio_in_sample_rate,
            )
        )
        text_user = stt_result.text.strip()
        if not text_user:
            raise EmptyTranscriptionError(
                "STT returned empty text. The child may not have spoken loudly enough."
            )

        # 2. Load session history from DB.
        history_rows = await db.execute(
            select(Turn.text_user, Turn.text_ai)
            .where(Turn.session_id == session_id)
            .order_by(Turn.sequence.asc())
        )
        messages: list[LLMMessage] = [LLMMessage(role="system", content=_SYSTEM_PROMPT)]
        for row in history_rows:
            messages.append(LLMMessage(role="user", content=row.text_user))
            messages.append(LLMMessage(role="assistant", content=row.text_ai))
        messages.append(LLMMessage(role="user", content=text_user))
        llm_response = await self._llm.invoke(messages, max_tokens=200)
        text_ai = llm_response.text.strip()

        # 3. TTS
        tts_voice = voice or settings.volc_tts_default_voice
        tts_format: TTSAudioFormat = settings.volc_tts_audio_format  # type: ignore[assignment]
        tts_result = await self._tts.invoke(
            TTSRequest(
                text=text_ai,
                voice=tts_voice,
                audio_format=tts_format,
                sample_rate=settings.volc_tts_sample_rate,
            )
        )

        # 4. Persist — compute next sequence within this session.
        seq_result = await db.execute(
            select(func.coalesce(func.max(Turn.sequence), 0)).where(Turn.session_id == session_id)
        )
        next_sequence: int = seq_result.scalar_one() + 1

        turn_id = uuid.uuid4()
        audio_in_path, audio_out_path = _maybe_persist_audio(
            turn_id=turn_id,
            learner_id=learner_id,
            audio_in=audio_in,
            audio_in_format=audio_in_format,
            audio_out=tts_result.audio,
            audio_out_format=tts_result.audio_format,
        )

        turn = Turn(
            id=turn_id,
            learner_id=learner_id,
            session_id=session_id,
            sequence=next_sequence,
            text_user=text_user,
            text_ai=text_ai,
            audio_in_path=audio_in_path,
            audio_out_path=audio_out_path,
            stt_audio_seconds=stt_result.audio_seconds,
            llm_input_tokens=llm_response.input_tokens,
            llm_output_tokens=llm_response.output_tokens,
            tts_chars=tts_result.chars,
        )
        db.add(turn)
        await db.commit()

        return TurnResult(
            turn_id=turn_id,
            text_user=text_user,
            text_ai=text_ai,
            audio_out=tts_result.audio,
            audio_out_format=tts_result.audio_format,
            sample_rate=tts_result.sample_rate,
        )


class EmptyTranscriptionError(RuntimeError):
    """Raised when STT returns empty text — typically silent / too-quiet audio."""


def _maybe_persist_audio(
    *,
    turn_id: uuid.UUID,
    learner_id: uuid.UUID,
    audio_in: bytes,
    audio_in_format: STTAudioFormat,
    audio_out: bytes,
    audio_out_format: TTSAudioFormat,
) -> tuple[str | None, str | None]:
    if not settings.audio_storage_enabled:
        return None, None

    base = Path(settings.audio_storage_dir) / str(learner_id)
    base.mkdir(parents=True, exist_ok=True)

    in_ext = "ogg" if audio_in_format == "ogg" else audio_in_format
    out_ext = "mp3" if audio_out_format == "mp3" else audio_out_format

    in_path = base / f"{turn_id}_in.{in_ext}"
    out_path = base / f"{turn_id}_out.{out_ext}"
    in_path.write_bytes(audio_in)
    out_path.write_bytes(audio_out)

    return str(in_path), str(out_path)
