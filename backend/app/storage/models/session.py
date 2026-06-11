from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class Session(Base, TimestampMixin):
    """A conversation session grouping multiple turns for one learner.

    Sessions have no explicit end state — the user can always return to any
    session. ``updated_at`` serves as the last-activity timestamp and is
    touched on every new turn so the sidebar stays sorted by recency.

    ``title`` starts NULL and is filled by a small LLM call after the first
    turn. The user can rename it at any time.

    ``group_id`` is the active scope. NULL means free practice (scope falls
    back to the learner's cefr_level, or calibration mode if level is unset).

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
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_group.id", ondelete="SET NULL"), nullable=True
    )


class SessionShareLink(Base, TimestampMixin):
    """Public, anonymous share code for one chat session (growth / word-of-mouth).

    The share URL embeds the code; anyone holding it can read the conversation
    and play stored audio — no auth. The PUBLIC API response hides learner
    identity, but the underlying rows keep everything: a future "show name /
    avatar" toggle is an API change, not a data backfill.

    ``revoked`` kills the link outright (the public endpoints 404) — unlike
    ``GroupShareLink``, there is no adoption state to preserve.
    """

    __tablename__ = "session_share_link"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("session.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Unambiguous-alphabet code (no 0/O/1/I/L); 12 chars — this link is public
    #: on the open internet, so the keyspace is larger than group share codes.
    code: Mapped[str] = mapped_column(String(12), nullable=False, unique=True)
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
