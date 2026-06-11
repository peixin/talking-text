"""Material sharing across accounts — share links, adoption, subscriptions.

Design: docs/learner-content-scope.md §6 (UC-5/6/7), §7, §8.4.

Private, link-based sharing only (no public library — copyright stays between
consenting parents). A share link is created for a ROOT group (a whole book);
the receiver chooses the semantics at adoption time:

- subscribe — live reference; the owner's edits propagate; receiver read-only.
- clone     — deep copy; independent ever after.

A subscriber may later FORK (clone + replace the subscription, keeping learner
assignments). Re-sharing a subscribed group is impossible by construction: the
create endpoint requires ownership (§7.3).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.core.sharing import clone_group_tree
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.content import (
    GroupShareLink,
    ItemGroup,
    ItemGroupLearner,
    ItemGroupMember,
    ItemGroupSubscription,
    get_descendant_group_ids,
)
from app.storage.models.learner import Learner

router = APIRouter(tags=["share"])

#: Code alphabet without visually ambiguous characters (no 0/O/1/I/L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 8


# ── Schemas ──────────────────────────────────────────────────────────────────


class ShareLinkOut(BaseModel):
    code: str
    expires_at: datetime | None
    revoked: bool


class SharePreviewOut(BaseModel):
    name: str
    kind: str
    level_title: str | None
    cover_image_url: str | None
    owner_name: str
    item_count: int
    unit_count: int  # direct children of the root (units/sub-collections)


class AdoptBody(BaseModel):
    mode: Literal["subscribe", "clone"]


class AdoptOut(BaseModel):
    group_id: uuid.UUID
    mode: Literal["subscribe", "clone"]


class SubscriptionOut(BaseModel):
    id: uuid.UUID
    #: NULL = tombstone (the source owner deleted the book; see §7.1).
    source_group_id: uuid.UUID | None
    name: str | None
    item_count: int
    subscribed_at: datetime


class ForkOut(BaseModel):
    group_id: uuid.UUID


# ── Helpers ──────────────────────────────────────────────────────────────────


def _link_active(link: GroupShareLink) -> bool:
    if link.revoked:
        return False
    return link.expires_at is None or link.expires_at > datetime.now(UTC)


async def _resolve_active_link(code: str, db: AsyncSession) -> tuple[GroupShareLink, ItemGroup]:
    row = await db.execute(select(GroupShareLink).where(GroupShareLink.code == code.upper()))
    link = row.scalar_one_or_none()
    if not link or not _link_active(link):
        raise HTTPException(status_code=404, detail="SHARE_LINK_NOT_FOUND")
    group = (
        await db.execute(select(ItemGroup).where(ItemGroup.id == link.group_id))
    ).scalar_one_or_none()
    if not group or group.archived:
        raise HTTPException(status_code=404, detail="SHARE_LINK_NOT_FOUND")
    return link, group


async def _subtree_item_count(db: AsyncSession, root_id: uuid.UUID) -> int:
    ids = await get_descendant_group_ids(db, root_id)
    count = await db.scalar(
        select(func.count(func.distinct(ItemGroupMember.item_id))).where(
            ItemGroupMember.group_id.in_(ids)
        )
    )
    return int(count or 0)


async def _assign_root_to_active_learner(
    db: AsyncSession, group_id: uuid.UUID, account: Account
) -> None:
    """Make the adopted book immediately usable for the adopter's active learner."""
    if account.last_active_learner_id is None:
        return
    await db.execute(
        pg_insert(ItemGroupLearner)
        .values(group_id=group_id, learner_id=account.last_active_learner_id)
        .on_conflict_do_nothing(index_elements=["group_id", "learner_id"])
    )


# ── Share-link management (owner side) ───────────────────────────────────────


@router.post("/groups/{group_id}/share-link", response_model=ShareLinkOut)
async def create_share_link(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ShareLinkOut:
    """Create (or return the existing active) share code for an owned root group.

    Ownership is required — a subscriber cannot re-share (§7.3). Idempotent:
    one active code per group, so the same book always shares the same link.
    """
    group = (
        await db.execute(select(ItemGroup).where(ItemGroup.id == group_id))
    ).scalar_one_or_none()
    if not group or group.owner_account_id != account.id:
        raise HTTPException(status_code=403, detail="CANNOT_SHARE_NON_OWNED_GROUP")
    if group.parent_id is not None:
        raise HTTPException(status_code=400, detail="ONLY_ROOT_GROUPS_CAN_BE_SHARED")

    existing = (
        await db.execute(
            select(GroupShareLink).where(
                GroupShareLink.group_id == group_id,
                GroupShareLink.revoked.is_(False),
            )
        )
    ).scalar_one_or_none()
    if existing and _link_active(existing):
        return ShareLinkOut(code=existing.code, expires_at=existing.expires_at, revoked=False)

    link = GroupShareLink(
        group_id=group_id,
        code="".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH)),
        created_by_account_id=account.id,
    )
    db.add(link)
    await db.commit()
    return ShareLinkOut(code=link.code, expires_at=link.expires_at, revoked=False)


@router.delete(
    "/groups/{group_id}/share-link", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def revoke_share_link(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Revoke all active codes for a group. Blocks new adoptions only —
    existing subscribers keep access (cutting them off is the owner deleting
    the book, which tombstones subscriptions)."""
    group = (
        await db.execute(select(ItemGroup).where(ItemGroup.id == group_id))
    ).scalar_one_or_none()
    if not group or group.owner_account_id != account.id:
        raise HTTPException(status_code=403, detail="CANNOT_SHARE_NON_OWNED_GROUP")
    rows = (
        (
            await db.execute(
                select(GroupShareLink).where(
                    GroupShareLink.group_id == group_id, GroupShareLink.revoked.is_(False)
                )
            )
        )
        .scalars()
        .all()
    )
    for link in rows:
        link.revoked = True
    await db.commit()


# ── Receiver side ─────────────────────────────────────────────────────────────


@router.get("/shares/{code}", response_model=SharePreviewOut)
async def preview_share(code: str, db: Annotated[AsyncSession, Depends(get_db)]) -> SharePreviewOut:
    """Public preview of a shared book — name/counts only, no content.

    Unauthenticated by design: the receiver sees what they were invited to
    before logging in (docs/learner-content-scope.md §8.4).
    """
    _, group = await _resolve_active_link(code, db)
    owner_name = await db.scalar(select(Account.name).where(Account.id == group.owner_account_id))
    unit_count = await db.scalar(
        select(func.count(ItemGroup.id)).where(
            ItemGroup.parent_id == group.id, ItemGroup.archived.is_(False)
        )
    )
    return SharePreviewOut(
        name=group.name,
        kind=group.kind,
        level_title=group.level_title,
        cover_image_url=group.cover_image_url,
        owner_name=owner_name or "",
        item_count=await _subtree_item_count(db, group.id),
        unit_count=int(unit_count or 0),
    )


@router.post("/shares/{code}/adopt", response_model=AdoptOut)
async def adopt_share(
    code: str,
    body: AdoptBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdoptOut:
    """Adopt a shared book: live subscription or independent clone (receiver's choice)."""
    _, group = await _resolve_active_link(code, db)

    if group.owner_account_id == account.id:
        raise HTTPException(status_code=400, detail="CANNOT_ADOPT_OWN_GROUP")

    if body.mode == "subscribe":
        existing = (
            await db.execute(
                select(ItemGroupSubscription).where(
                    ItemGroupSubscription.subscriber_account_id == account.id,
                    ItemGroupSubscription.source_group_id == group.id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                ItemGroupSubscription(subscriber_account_id=account.id, source_group_id=group.id)
            )
            await db.flush()
        await _assign_root_to_active_learner(db, group.id, account)
        await db.commit()
        return AdoptOut(group_id=group.id, mode="subscribe")

    # mode == "clone"
    new_root = await clone_group_tree(
        db,
        group,
        new_owner_account_id=account.id,
        active_learner_id=account.last_active_learner_id,
    )
    await _assign_root_to_active_learner(db, new_root.id, account)
    await db.commit()
    return AdoptOut(group_id=new_root.id, mode="clone")


@router.get("/subscriptions", response_model=list[SubscriptionOut])
async def list_subscriptions(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SubscriptionOut]:
    """The caller's subscriptions, including tombstones (source deleted — §7.1)."""
    rows = (
        await db.execute(
            select(ItemGroupSubscription, ItemGroup)
            .outerjoin(ItemGroup, ItemGroup.id == ItemGroupSubscription.source_group_id)
            .where(ItemGroupSubscription.subscriber_account_id == account.id)
            .order_by(ItemGroupSubscription.subscribed_at.desc())
        )
    ).all()
    out: list[SubscriptionOut] = []
    for sub, group in rows:
        out.append(
            SubscriptionOut(
                id=sub.id,
                source_group_id=group.id if group else None,
                name=group.name if group else None,
                item_count=await _subtree_item_count(db, group.id) if group else 0,
                subscribed_at=sub.subscribed_at,
            )
        )
    return out


async def _require_subscription(
    subscription_id: uuid.UUID, account: Account, db: AsyncSession
) -> ItemGroupSubscription:
    sub = (
        await db.execute(
            select(ItemGroupSubscription).where(
                ItemGroupSubscription.id == subscription_id,
                ItemGroupSubscription.subscriber_account_id == account.id,
            )
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return sub


async def _account_learner_ids(db: AsyncSession, account_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(select(Learner.id).where(Learner.account_id == account_id))
    return [lid for (lid,) in rows]


@router.post("/subscriptions/{subscription_id}/fork", response_model=ForkOut)
async def fork_subscription(
    subscription_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ForkOut:
    """Turn a subscription into an editable clone (§7.2).

    Deep-copies the source, re-points the subscriber's learner assignments to
    the clone (mastery stats survive untouched — items are canonical), then
    deletes the subscription. Single transaction.
    """
    sub = await _require_subscription(subscription_id, account, db)
    if sub.source_group_id is None:
        raise HTTPException(status_code=410, detail="SHARE_SOURCE_DELETED")
    source = (
        await db.execute(select(ItemGroup).where(ItemGroup.id == sub.source_group_id))
    ).scalar_one()

    new_root = await clone_group_tree(
        db,
        source,
        new_owner_account_id=account.id,
        active_learner_id=account.last_active_learner_id,
    )

    # Re-point this account's learner assignments from the source to the clone.
    my_learners = await _account_learner_ids(db, account.id)
    if my_learners:
        assignments = (
            (
                await db.execute(
                    select(ItemGroupLearner).where(
                        ItemGroupLearner.group_id == source.id,
                        ItemGroupLearner.learner_id.in_(my_learners),
                    )
                )
            )
            .scalars()
            .all()
        )
        for a in assignments:
            db.add(ItemGroupLearner(group_id=new_root.id, learner_id=a.learner_id))
            await db.delete(a)

    await db.delete(sub)
    await db.commit()
    return ForkOut(group_id=new_root.id)


@router.delete(
    "/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def delete_subscription(
    subscription_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Unsubscribe (or dismiss a tombstone). Also detaches this account's
    learner assignments from the source group so nothing dangles."""
    sub = await _require_subscription(subscription_id, account, db)
    if sub.source_group_id is not None:
        my_learners = await _account_learner_ids(db, account.id)
        if my_learners:
            await db.execute(
                delete(ItemGroupLearner).where(
                    ItemGroupLearner.group_id == sub.source_group_id,
                    ItemGroupLearner.learner_id.in_(my_learners),
                )
            )
    await db.delete(sub)
    await db.commit()
