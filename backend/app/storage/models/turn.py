from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class Turn(Base, TimestampMixin):
    """One conversation turn: child speaks, AI replies.

    A turn is the atomic unit of billing and the parent of any vocab_event rows
    written from it. We deliberately do not introduce a Session entity in V1;
    short-term context is carried by the frontend per request.
    """

    __tablename__ = "turn"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, index=True
    )

    text_user: Mapped[str] = mapped_column(Text, nullable=False)
    text_ai: Mapped[str] = mapped_column(Text, nullable=False)

    # Local file path under AUDIO_STORAGE_DIR; switches to TOS URL in V2.
    audio_in_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    audio_out_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Cost-bearing usage (for billing).
    stt_audio_seconds: Mapped[float] = mapped_column(Float, nullable=False, server_default="0")
    llm_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    llm_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tts_chars: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
