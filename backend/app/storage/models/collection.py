from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin

class Collection(Base, TimestampMixin):
    """A user-defined collection of language items (e.g. 'My Travel Words')."""

    __tablename__ = "collection"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    owner_learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default="false")

class CollectionItem(Base, TimestampMixin):
    """Many-to-many: collection ↔ language_item."""

    __tablename__ = "collection_item"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("collection.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
