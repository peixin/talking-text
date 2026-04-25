from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

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

    account: Mapped[Account] = relationship(
        "Account", back_populates="learners", foreign_keys=[account_id]
    )
