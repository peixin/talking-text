"""Single-turn conversation orchestrator.

End-to-end flow for one turn (V1, batch):

    voice input  -> STT -> text_user -> LLM -> text_ai -> TTS -> audio_out
    text input            -> text_user -> LLM -> text_ai
                                                          (TTS skipped; generated on demand)

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
    audio_out: bytes | None  # None when generate_audio=False
    audio_out_format: TTSAudioFormat | None  # None when generate_audio=False


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
        # 1. Resolve text_user from voice (STT) or direct text input.
        if text_user is not None:
            resolved_text_user = text_user.strip()
            stt_audio_seconds: float = 0.0
        elif audio_in is not None:
            stt_result = await self._stt.invoke(
                STTRequest(
                    audio=audio_in,
                    audio_format=audio_in_format,
                    sample_rate=audio_in_sample_rate,
                )
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
        history_rows = await db.execute(
            select(Turn.text_user, Turn.text_ai)
            .where(Turn.session_id == session_id)
            .order_by(Turn.sequence.asc())
        )
        messages: list[LLMMessage] = [LLMMessage(role="system", content=_SYSTEM_PROMPT)]
        for row in history_rows:
            messages.append(LLMMessage(role="user", content=row.text_user))
            messages.append(LLMMessage(role="assistant", content=row.text_ai))
        messages.append(LLMMessage(role="user", content=resolved_text_user))
        llm_response = await self._llm.invoke(messages, max_tokens=200)
        text_ai = llm_response.text.strip()

        # 3. TTS — only in voice mode (text mode generates on demand via get_turn_audio).
        audio_out: bytes | None = None
        audio_out_format: TTSAudioFormat | None = None
        tts_chars: int = 0

        if generate_audio:
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

        # 4. Persist turn.
        seq_result = await db.execute(
            select(func.coalesce(func.max(Turn.sequence), 0)).where(Turn.session_id == session_id)
        )
        next_sequence: int = seq_result.scalar_one() + 1

        turn_id = uuid.uuid4()
        audio_in_path, audio_out_path = _persist_audio_files(
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

        return TurnResult(
            turn_id=turn_id,
            text_user=resolved_text_user,
            text_ai=text_ai,
            audio_out=audio_out,
            audio_out_format=audio_out_format,
        )


class EmptyTranscriptionError(RuntimeError):
    """Raised when STT returns empty text — typically silent / too-quiet audio."""


def _persist_audio_files(
    *,
    turn_id: uuid.UUID,
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    audio_in: bytes | None,
    audio_in_format: STTAudioFormat,
    audio_out: bytes | None,
    audio_out_format: TTSAudioFormat | None,
) -> tuple[str | None, str | None]:
    if not settings.audio_storage_enabled:
        return None, None

    base = Path(settings.audio_storage_dir) / str(learner_id) / str(session_id)
    base.mkdir(parents=True, exist_ok=True)

    in_path: str | None = None
    if audio_in is not None:
        in_ext = "ogg" if audio_in_format == "ogg" else audio_in_format
        in_file = base / f"{turn_id}_in.{in_ext}"
        in_file.write_bytes(audio_in)
        in_path = str(in_file)

    out_path: str | None = None
    if audio_out is not None and audio_out_format is not None:
        out_ext = "mp3" if audio_out_format == "mp3" else audio_out_format
        out_file = base / f"{turn_id}_out.{out_ext}"
        out_file.write_bytes(audio_out)
        out_path = str(out_file)

    return in_path, out_path
