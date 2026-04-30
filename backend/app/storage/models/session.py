from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class Session(Base, TimestampMixin):
    """A conversation session grouping multiple turns for one learner.

    Sessions have no explicit end state — the user can always return to any
    session. ``updated_at`` serves as the last-activity timestamp and is
    touched on every new turn so the sidebar stays sorted by recency.

    ``title`` starts NULL and is filled by a small LLM call after the first
    turn. The user can rename it at any time.

    Soft-deleted sessions are hidden from the UI but retained in the DB so
    their turns remain queryable for billing and history.
    """

    __tablename__ = "session"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
