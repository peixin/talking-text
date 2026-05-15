from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class LanguageItem(Base, TimestampMixin):
    """Atomic learnable unit: word, phrase, or sentence pattern."""

    __tablename__ = "language_item"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(sa.String(10), nullable=False)  # word|phrase|pattern
    text: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    anchor: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    cefr_level: Mapped[str | None] = mapped_column(sa.String(4), nullable=True)
    pos: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)

    __table_args__ = (sa.UniqueConstraint("type", "text", name="uq_language_item_type_text"),)


class ItemGroup(Base, TimestampMixin):
    """A named bag of language items. The only organizing entity.

    ``parent_id`` enables arbitrary hierarchy (book → unit → lesson) or none
    (a flat collection). ``kind`` is one of: ``textbook_book``,
    ``textbook_unit``, ``textbook_lesson``, ``personal_collection``,
    ``quick_practice``, ``review_set``.
    """

    __tablename__ = "item_group"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("item_group.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(sa.String(30), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("account.id", ondelete="CASCADE"), nullable=False, index=True
    )

    cover_image_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    prompt_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    source_book_hint: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)

    archived: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )


class ItemGroupMember(Base, TimestampMixin):
    """Many-to-many: ``ItemGroup`` ↔ ``LanguageItem``."""

    __tablename__ = "item_group_member"

    group_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("item_group.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), primary_key=True
    )
