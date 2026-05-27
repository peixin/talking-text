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
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.content import ItemGroup, ItemGroupMember, LanguageItem

router = APIRouter(tags=["groups"])


# Free-form label. A handful of values are still well-known constants the rest of
# the codebase relies on (e.g. IngestDrawerClient creates "quick_practice"
# groups), but any value the parent or LLM types is accepted.
KindStr = Annotated[str, Field(min_length=1, max_length=30)]
ItemType = Literal["word", "phrase", "pattern"]


class ItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    type: ItemType
    anchor: str | None = None
    cefr_level: str | None = Field(default=None, pattern=r"^[ABC][12]$")
    pos: str | None = Field(default=None, max_length=20)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: KindStr = "generic"
    parent_id: uuid.UUID | None = None
    items: list[ItemIn] = Field(default_factory=list)
    prompt_notes: str | None = None
    source_book_hint: str | None = Field(default=None, max_length=200)
    levels: list[str] | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None
    parent_id: uuid.UUID | None = None
    kind: KindStr | None = None
    source_book_hint: str | None = Field(default=None, max_length=200)
    prompt_notes: str | None = None
    items: list[ItemIn] | None = None
    levels: list[str] | None = None


class LanguageItemOut(BaseModel):
    id: uuid.UUID
    type: str
    text: str
    anchor: str
    cefr_level: str | None = None
    pos: str | None = None

    model_config = {"from_attributes": True}


class GroupDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    parent_id: uuid.UUID | None = None
    archived: bool
    source_book_hint: str | None = None
    prompt_notes: str | None = None
    items: list[LanguageItemOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
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


async def _check_cycle(db: AsyncSession, group_id: uuid.UUID, parent_id: uuid.UUID) -> bool:
    curr_parent: uuid.UUID | None = parent_id
    visited = {group_id}
    while curr_parent is not None:
        if curr_parent in visited:
            return True
        visited.add(curr_parent)
        row = await db.execute(select(ItemGroup.parent_id).where(ItemGroup.id == curr_parent))
        curr_parent = row.scalar_one_or_none()
    return False


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
            kind=g.kind,
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
    if body.levels:
        valid_levels = [lvl.strip() for lvl in body.levels if lvl and lvl.strip()]
        if not valid_levels:
            raise HTTPException(status_code=400, detail="Levels list cannot be empty")

        curr_parent_id: uuid.UUID | None = None
        group: ItemGroup | None = None

        for idx, lvl_name in enumerate(valid_levels):
            # Find matching existing child node with case-insensitive and trimmed name comparison
            stmt = select(ItemGroup).where(
                ItemGroup.owner_account_id == account.id,
                ItemGroup.parent_id == curr_parent_id,
                func.lower(func.trim(ItemGroup.name)) == lvl_name.strip().lower(),
                ItemGroup.archived.is_(False),
            )
            res = await db.execute(stmt)
            existing = res.scalar_one_or_none()

            if existing:
                group = existing
                curr_parent_id = existing.id
                # Auto-normalize spelling to match the database standard
                valid_levels[idx] = existing.name
            else:
                # Deduce kind for this depth
                total = len(valid_levels)
                if idx == total - 1:
                    curr_kind = "textbook_lesson"
                elif total >= 3 and idx == total - 2:
                    curr_kind = "textbook_unit"
                else:
                    curr_kind = "textbook_book"

                group = ItemGroup(
                    name=lvl_name,
                    kind=curr_kind,
                    parent_id=curr_parent_id,
                    owner_account_id=account.id,
                )
                db.add(group)
                await db.flush()
                curr_parent_id = group.id

        # Bind final attributes to the leaf node
        if group:
            if body.prompt_notes:
                group.prompt_notes = body.prompt_notes
            if body.source_book_hint:
                group.source_book_hint = body.source_book_hint
    else:
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
        kind=group.kind,
        parent_id=group.parent_id,
        archived=group.archived,
        source_book_hint=group.source_book_hint,
        item_count=len(set(item_ids)),
    )


@router.get("/groups/{group_id}", response_model=GroupDetailOut)
async def get_group(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> GroupDetailOut:
    group = await _require_owned_group(group_id, account, db)

    stmt = (
        select(LanguageItem)
        .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
        .where(ItemGroupMember.group_id == group.id)
    )
    items = list((await db.execute(stmt)).scalars().all())

    return GroupDetailOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        parent_id=group.parent_id,
        archived=group.archived,
        source_book_hint=group.source_book_hint,
        prompt_notes=group.prompt_notes,
        items=[
            LanguageItemOut(
                id=item.id,
                type=item.type,
                text=item.text,
                anchor=item.anchor,
                cefr_level=item.cefr_level,
                pos=item.pos,
            )
            for item in items
        ],
    )


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: uuid.UUID,
    body: GroupUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> GroupOut:
    group = await _require_owned_group(group_id, account, db)

    update_data = body.model_dump(exclude_unset=True)

    if "levels" in update_data and update_data["levels"] is not None:
        valid_levels = [lvl.strip() for lvl in update_data["levels"] if lvl.strip()]
        if not valid_levels:
            raise HTTPException(status_code=400, detail="levels cannot be empty if specified")

        leaf_name = valid_levels[-1]
        parent_levels = valid_levels[:-1]

        curr_parent_id = None
        for idx, lvl_name in enumerate(parent_levels):
            stmt = select(ItemGroup).where(
                ItemGroup.owner_account_id == account.id,
                ItemGroup.parent_id == curr_parent_id,
                func.lower(func.trim(ItemGroup.name)) == lvl_name.lower(),
                ItemGroup.archived.is_(False),
                ItemGroup.id != group.id,
            )
            res = await db.execute(stmt)
            existing = res.scalar_one_or_none()

            if existing:
                curr_parent_id = existing.id
            else:
                total = len(valid_levels)
                curr_kind = "textbook_unit" if idx == total - 2 else "textbook_book"

                new_parent = ItemGroup(
                    name=lvl_name,
                    kind=curr_kind,
                    parent_id=curr_parent_id,
                    owner_account_id=account.id,
                )
                db.add(new_parent)
                await db.flush()
                curr_parent_id = new_parent.id

        group.name = leaf_name
        group.parent_id = curr_parent_id
        if len(valid_levels) >= 3:
            group.kind = "textbook_lesson"
        elif len(valid_levels) == 2:
            group.kind = "textbook_unit"
        else:
            group.kind = "textbook_book"
    else:
        if "name" in update_data:
            group.name = update_data["name"].strip()
        if update_data.get("kind"):
            group.kind = update_data["kind"].strip()
        if "parent_id" in update_data:
            p_id = update_data["parent_id"]
            if p_id is not None:
                if p_id == group.id:
                    raise HTTPException(
                        status_code=400,
                        detail="A group cannot be its own parent",
                    )
                await _require_owned_group(p_id, account, db)
                if await _check_cycle(db, group.id, p_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Circular parent relationship detected",
                    )
            group.parent_id = p_id

    if "archived" in update_data:
        group.archived = update_data["archived"]
    if "source_book_hint" in update_data:
        group.source_book_hint = update_data["source_book_hint"] or None
    if "prompt_notes" in update_data:
        group.prompt_notes = update_data["prompt_notes"] or None

    if "items" in update_data:
        await db.execute(delete(ItemGroupMember).where(ItemGroupMember.group_id == group.id))
        item_ids = await _upsert_language_items(db, body.items or [])
        if item_ids:
            await db.execute(
                pg_insert(ItemGroupMember)
                .values([{"group_id": group.id, "item_id": iid} for iid in set(item_ids)])
                .on_conflict_do_nothing(index_elements=["group_id", "item_id"])
            )

    await db.commit()
    await db.refresh(group)

    count_row = await db.execute(
        select(ItemGroupMember.item_id).where(ItemGroupMember.group_id == group.id)
    )
    item_count = len(list(count_row.scalars().all()))

    return GroupOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        parent_id=group.parent_id,
        archived=group.archived,
        source_book_hint=group.source_book_hint,
        item_count=item_count,
    )


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_group(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    group = await _require_owned_group(group_id, account, db)
    await db.delete(group)
    await db.commit()
