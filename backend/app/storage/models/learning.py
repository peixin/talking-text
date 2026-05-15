from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class LearnerItemStats(Base, TimestampMixin):
    """Per-learner mastery tracking for language items.

    A row exists only after the item has first appeared in a session. A NULL
    ``mastered_at`` means the threshold has not been crossed yet.
    """

    __tablename__ = "learner_item_stats"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), primary_key=True
    )
    seen_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    used_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    correct_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    last_seen: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    mastered_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)


class LearnerCalibrationTurn(Base, TimestampMixin):
    """Per-turn CEFR estimate during the first conversation with a learner.

    Rows accumulate until either three consecutive estimates agree or five
    turns have been seen; at that point ``calibration.maybe_settle()`` writes
    the working level to ``learner.cefr_level`` and no further rows are
    produced for that learner.
    """

    __tablename__ = "learner_calibration_turn"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("session.id", ondelete="CASCADE"), nullable=False
    )
    turn_sequence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    estimated_level: Mapped[str] = mapped_column(sa.String(4), nullable=False)
    confidence: Mapped[str] = mapped_column(sa.String(10), nullable=False)
    evidence: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
