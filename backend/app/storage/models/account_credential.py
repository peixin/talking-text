from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.storage.base import Base, TimestampMixin
from app.storage.enums import CredentialProvider

if TYPE_CHECKING:
    from app.storage.models.account import Account


class AccountCredential(Base, TimestampMixin):
    __tablename__ = "account_credential"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[CredentialProvider] = mapped_column(String(20), nullable=False)
    # email address / phone number / openid depending on provider
    identifier: Mapped[str] = mapped_column(String(254), nullable=False)
    # Hashed password for email/phone login; NULL for OAuth providers
    password: Mapped[str | None] = mapped_column(String(72), nullable=True)
    # Provider-specific extras: wechat unionid, oauth tokens, etc.
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        # Same provider+identifier cannot belong to two accounts
        UniqueConstraint("provider", "identifier", name="uq_credential_provider_identifier"),
    )

    account: Mapped[Account] = relationship("Account", back_populates="credentials")
