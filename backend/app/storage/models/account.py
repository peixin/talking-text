from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.storage.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.storage.models.account_credential import AccountCredential
    from app.storage.models.learner import Learner


class Account(Base, TimestampMixin):
    __tablename__ = "account"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    last_active_learner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("learner.id", ondelete="SET NULL"), nullable=True
    )

    credentials: Mapped[list[AccountCredential]] = relationship(
        "AccountCredential",
        back_populates="account",
        cascade="all, delete-orphan",
        foreign_keys="[AccountCredential.account_id]",
    )
    learners: Mapped[list[Learner]] = relationship(
        "Learner",
        back_populates="account",
        cascade="all, delete-orphan",
        foreign_keys="[Learner.account_id]",
    )
