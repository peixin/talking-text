"""Item-group CRUD endpoints.

Groups are owned by an Account (not a Learner) so siblings in the same family
can share materials. Mastery (LearnerItemStats) is what makes each learner's
experience distinct. See docs/content-model.md §2.6, §3.2.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.content import ItemGroup, ItemGroupMember, LanguageItem

router = APIRouter(tags=["groups"])


GroupKind = Literal[
    "textbook_book",
    "textbook_unit",
    "textbook_lesson",
    "personal_collection",
    "quick_practice",
    "review_set",
]
ItemType = Literal["word", "phrase", "pattern"]


class ItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    type: ItemType
    anchor: str | None = None
    cefr_level: str | None = Field(default=None, pattern=r"^[ABC][12]$")
    pos: str | None = Field(default=None, max_length=20)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: GroupKind = "personal_collection"
    parent_id: uuid.UUID | None = None
    items: list[ItemIn] = Field(default_factory=list)
    prompt_notes: str | None = None
    source_book_hint: str | None = Field(default=None, max_length=200)


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: GroupKind
    parent_id: uuid.UUID | None
    archived: bool
    source_book_hint: str | None
    item_count: int

    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────────


def _normalize_anchor(item: ItemIn) -> str:
    if item.anchor:
        return item.anchor.strip().lower()
    if item.type == "pattern":
        return re.sub(r"_+", " ", item.text).strip().lower()
    return item.text.strip().lower()


async def _upsert_language_items(db: AsyncSession, items: list[ItemIn]) -> list[uuid.UUID]:
    """Insert any items not yet in language_item; return ids for every input.

    Uses (type, text) UNIQUE constraint with ON CONFLICT DO NOTHING so concurrent
    ingestions don't race; the follow-up SELECT picks up the canonical rows.
    """
    if not items:
        return []

    rows = [
        {
            "id": uuid.uuid4(),
            "type": item.type,
            "text": item.text.strip(),
            "anchor": _normalize_anchor(item),
            "cefr_level": item.cefr_level,
            "pos": item.pos,
        }
        for item in items
    ]
    await db.execute(
        pg_insert(LanguageItem).values(rows).on_conflict_do_nothing(index_elements=["type", "text"])
    )

    keys = [(r["type"], r["text"]) for r in rows]
    result = await db.execute(
        select(LanguageItem.id, LanguageItem.type, LanguageItem.text).where(
            LanguageItem.type.in_({t for t, _ in keys}),
            LanguageItem.text.in_({t for _, t in keys}),
        )
    )
    by_key = {(row.type, row.text): row.id for row in result}
    return [by_key[(t, txt)] for t, txt in keys]


async def _require_owned_group(
    group_id: uuid.UUID, account: Account, db: AsyncSession
) -> ItemGroup:
    row = await db.execute(
        select(ItemGroup).where(ItemGroup.id == group_id, ItemGroup.owner_account_id == account.id)
    )
    group = row.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    parent_id: uuid.UUID | None = None,
    include_archived: bool = False,
) -> list[GroupOut]:
    stmt = select(ItemGroup).where(ItemGroup.owner_account_id == account.id)
    if parent_id is not None:
        stmt = stmt.where(ItemGroup.parent_id == parent_id)
    if not include_archived:
        stmt = stmt.where(ItemGroup.archived.is_(False))
    stmt = stmt.order_by(ItemGroup.created_at.desc())
    groups = list((await db.execute(stmt)).scalars().all())

    if not groups:
        return []

    count_rows = await db.execute(
        select(ItemGroupMember.group_id).where(ItemGroupMember.group_id.in_([g.id for g in groups]))
    )
    count_by_group: dict[uuid.UUID, int] = {}
    for (gid,) in count_rows:
        count_by_group[gid] = count_by_group.get(gid, 0) + 1

    return [
        GroupOut(
            id=g.id,
            name=g.name,
            kind=g.kind,  # type: ignore[arg-type]
            parent_id=g.parent_id,
            archived=g.archived,
            source_book_hint=g.source_book_hint,
            item_count=count_by_group.get(g.id, 0),
        )
        for g in groups
    ]


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> GroupOut:
    if body.parent_id is not None:
        await _require_owned_group(body.parent_id, account, db)

    group = ItemGroup(
        name=body.name.strip(),
        kind=body.kind,
        parent_id=body.parent_id,
        owner_account_id=account.id,
        prompt_notes=(body.prompt_notes or None),
        source_book_hint=(body.source_book_hint or None),
    )
    db.add(group)
    await db.flush()

    item_ids = await _upsert_language_items(db, body.items)
    if item_ids:
        await db.execute(
            pg_insert(ItemGroupMember)
            .values([{"group_id": group.id, "item_id": iid} for iid in set(item_ids)])
            .on_conflict_do_nothing(index_elements=["group_id", "item_id"])
        )

    await db.commit()

    return GroupOut(
        id=group.id,
        name=group.name,
        kind=group.kind,  # type: ignore[arg-type]
        parent_id=group.parent_id,
        archived=group.archived,
        source_book_hint=group.source_book_hint,
        item_count=len(set(item_ids)),
    )
