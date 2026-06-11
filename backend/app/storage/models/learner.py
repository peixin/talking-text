from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.storage.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.storage.models.account import Account


class Learner(Base, TimestampMixin):
    __tablename__ = "learner"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    ai_name: Mapped[str] = mapped_column(
        String(100), nullable=False, server_default=sa.text("'Tina'")
    )
    ai_gender: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=sa.text("'female'")
    )
    ai_persona_prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # How aggressively the AI corrects mistakes: gentle | strict | native.
    # gentle = interest-first (severe / current grammar point / repeated-in-session only);
    # strict = correct every error; native = strict + idiomatic phrasing suggestions.
    correction_level: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa.text("'gentle'")
    )

    cefr_level: Mapped[str | None] = mapped_column(String(4), nullable=True)

    account: Mapped[Account] = relationship(
        "Account", back_populates="learners", foreign_keys=[account_id]
    )
