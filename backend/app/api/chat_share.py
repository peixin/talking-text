"""Public, anonymous chat sharing — a growth feature.

A parent shares one of the child's sessions as an open link; anyone holding it
can read the conversation and play stored audio without logging in. The DB
keeps full identity (session → learner); anonymity is applied at THIS layer
only — the public response carries no learner fields, so a future "show name /
avatar" toggle is purely additive.

Hard rules for the public endpoints:
- 404 for anything not an active link (revoked / expired / deleted session) —
  no distinction leaked.
- Audio is served from storage only; the on-demand TTS fallback of the
  authenticated endpoint is deliberately absent (strangers must not be able to
  trigger paid TTS calls). No stored audio → 404, the page degrades to text.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.api.session import _require_session, _serve_stored_audio
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner
from app.storage.models.session import Session, SessionShareLink
from app.storage.models.turn import Turn

router = APIRouter(tags=["chat-share"])

#: Code alphabet without visually ambiguous characters (no 0/O/1/I/L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
#: 12 chars over a 31-symbol alphabet ≈ 59 bits — enough for an unauthenticated,
#: internet-facing capability token.
_CODE_LENGTH = 12


# ── Schemas ──────────────────────────────────────────────────────────────────


class ChatShareLinkOut(BaseModel):
    code: str
    expires_at: datetime | None
    revoked: bool


class SharedTurnOut(BaseModel):
    id: uuid.UUID
    text_user: str
    text_ai: str
    has_audio_in: bool
    has_audio_out: bool


class SharedChatOut(BaseModel):
    """Anonymized public view: AI persona name only, never learner identity."""

    title: str | None
    ai_name: str
    created_at: datetime
    turns: list[SharedTurnOut]


# ── Helpers ──────────────────────────────────────────────────────────────────


def _link_active(link: SessionShareLink) -> bool:
    if link.revoked:
        return False
    return link.expires_at is None or link.expires_at > datetime.now(UTC)


async def _resolve_active_link(code: str, db: AsyncSession) -> tuple[SessionShareLink, Session]:
    row = await db.execute(select(SessionShareLink).where(SessionShareLink.code == code.upper()))
    link = row.scalar_one_or_none()
    if not link or not _link_active(link):
        raise HTTPException(status_code=404, detail="SHARE_LINK_NOT_FOUND")
    session = (
        await db.execute(
            select(Session).where(Session.id == link.session_id, Session.deleted.is_(False))
        )
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="SHARE_LINK_NOT_FOUND")
    return link, session


# ── Owner side ────────────────────────────────────────────────────────────────


@router.post("/sessions/{session_id}/share-link", response_model=ChatShareLinkOut)
async def create_chat_share_link(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatShareLinkOut:
    """Create (or return the existing active) public share code for an owned session."""
    await _require_session(session_id, account, db)

    existing = (
        (
            await db.execute(
                select(SessionShareLink).where(
                    SessionShareLink.session_id == session_id,
                    SessionShareLink.revoked.is_(False),
                )
            )
        )
        .scalars()
        .first()
    )
    if existing and _link_active(existing):
        return ChatShareLinkOut(code=existing.code, expires_at=existing.expires_at, revoked=False)

    link = SessionShareLink(
        session_id=session_id,
        code="".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH)),
        created_by_account_id=account.id,
    )
    db.add(link)
    await db.commit()
    return ChatShareLinkOut(code=link.code, expires_at=link.expires_at, revoked=False)


@router.delete(
    "/sessions/{session_id}/share-link",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def revoke_chat_share_link(
    session_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Revoke all active codes for a session — the public page 404s immediately."""
    await _require_session(session_id, account, db)
    rows = (
        (
            await db.execute(
                select(SessionShareLink).where(
                    SessionShareLink.session_id == session_id,
                    SessionShareLink.revoked.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    for link in rows:
        link.revoked = True
    await db.commit()


# ── Public side (no auth) ─────────────────────────────────────────────────────


@router.get("/shared-chats/{code}", response_model=SharedChatOut)
async def get_shared_chat(code: str, db: Annotated[AsyncSession, Depends(get_db)]) -> SharedChatOut:
    """Anonymized public view of a shared session."""
    _, session = await _resolve_active_link(code, db)
    ai_name = await db.scalar(select(Learner.ai_name).where(Learner.id == session.learner_id))
    rows = await db.execute(
        select(Turn).where(Turn.session_id == session.id).order_by(Turn.sequence.asc())
    )
    turns = [
        SharedTurnOut(
            id=t.id,
            text_user=t.text_user,
            text_ai=t.text_ai,
            has_audio_in=t.audio_in_path is not None,
            has_audio_out=t.audio_out_path is not None,
        )
        for t in rows.scalars()
    ]
    return SharedChatOut(
        title=session.title,
        ai_name=ai_name or "Tina",
        created_at=session.created_at,
        turns=turns,
    )


@router.get("/shared-chats/{code}/turns/{turn_id}/audio")
async def get_shared_chat_audio(
    code: str,
    turn_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    dir: Literal["in", "out"] = "out",
) -> Response:
    """Stored audio for a shared turn. Never generates TTS — 404 when absent."""
    _, session = await _resolve_active_link(code, db)
    row = await db.execute(select(Turn).where(Turn.id == turn_id, Turn.session_id == session.id))
    turn = row.scalar_one_or_none()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")

    served = await _serve_stored_audio(turn.audio_in_path if dir == "in" else turn.audio_out_path)
    if served is None:
        raise HTTPException(status_code=404, detail="AUDIO_NOT_AVAILABLE")
    return served
