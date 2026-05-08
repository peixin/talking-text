from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class LanguageItem(Base, TimestampMixin):
    """Atomic learnable unit: word, phrase, or sentence pattern."""

    __tablename__ = "language_item"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(sa.String(10), nullable=False)  # word|phrase|pattern
    text: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    anchor: Mapped[str] = mapped_column(sa.String(200), nullable=False)  # lowercase fixed substring

    __table_args__ = (sa.UniqueConstraint("type", "text", name="uq_language_item_type_text"),)


class Curriculum(Base, TimestampMixin):
    """A textbook or curriculum source (public or private)."""

    __tablename__ = "curriculum"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    publisher: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    is_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default="false")
    owner_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("account.id", ondelete="SET NULL"), nullable=True
    )


class CurriculumUnit(Base, TimestampMixin):
    """A unit within a curriculum (grouping only)."""

    __tablename__ = "curriculum_unit"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    curriculum_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    unit_number: Mapped[str] = mapped_column(sa.String(50), nullable=False)
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)


class CurriculumLesson(Base, TimestampMixin):
    """A single lesson — the smallest practice unit."""

    __tablename__ = "curriculum_lesson"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_unit.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    prompt_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    focus_instructions: Mapped[str | None] = mapped_column(sa.Text, nullable=True)


class LessonItem(Base, TimestampMixin):
    """Many-to-many: lesson ↔ language_item."""

    __tablename__ = "lesson_item"

    lesson_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_lesson.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )


class LearnerLesson(Base, TimestampMixin):
    """Append-only log: learner has studied this lesson."""

    __tablename__ = "learner_lesson"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_lesson.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )


class LearnerItemStats(Base, TimestampMixin):
    """Per-learner mastery tracking for language items (schema-only in V1)."""

    __tablename__ = "learner_item_stats"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    seen_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    used_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    correct_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    last_seen: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
