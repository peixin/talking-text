"""Item-group CRUD endpoints.

Groups are owned by an Account (not a Learner) so siblings in the same family
can share materials. Mastery (LearnerItemStats) is what makes each learner's
experience distinct. See docs/content-model.md §2.6, §3.2.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import CursorResult, delete, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import factory
from app.adapters.llm.protocol import LLMMessage
from app.api.auth import get_current_account
from app.app_config import app_config
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.content import (
    IngestionBatch,
    ItemGroup,
    ItemGroupLearner,
    ItemGroupMember,
    ItemGroupSubscription,
    LanguageItem,
)
from app.storage.models.learner import Learner
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)

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
    #: Ordered list of exact tag names (root → leaf) to nest into a single-parent
    #: tree. Used by the organize workbench; supplied by a human, not inferred at
    #: capture time. See docs/content-lifecycle.md §4.4.
    tag_path: list[str] | None = None
    level_titles: list[str] | None = None
    source_raw_text: str | None = None
    media_urls: list[str] | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None
    parent_id: uuid.UUID | None = None
    kind: KindStr | None = None
    source_book_hint: str | None = Field(default=None, max_length=200)
    prompt_notes: str | None = None
    items: list[ItemIn] | None = None
    #: See ``GroupCreate.tag_path``. On update, the last element renames this group
    #: and the preceding elements (re)build its ancestor chain.
    tag_path: list[str] | None = None
    level_titles: list[str] | None = None
    source_raw_text: str | None = None
    media_urls: list[str] | None = None


class LanguageItemOut(BaseModel):
    id: uuid.UUID
    type: str
    text: str
    anchor: str
    cefr_level: str | None = None
    pos: str | None = None
    source_group_name: str | None = None
    source_group_id: uuid.UUID | None = None

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
    level_title: str | None = None

    model_config = {"from_attributes": True}


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    parent_id: uuid.UUID | None
    archived: bool
    source_book_hint: str | None
    item_count: int
    level_title: str | None = None

    model_config = {"from_attributes": True}


class LearnerAssignmentOut(BaseModel):
    learner_id: uuid.UUID
    assigned_at: str  # ISO-8601

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

    # Use exact (type, text) tuple matching to avoid the Cartesian-product false
    # positives that arise from separate `type IN (...)` AND `text IN (...)`
    # predicates. SQLAlchemy emits `(type, text) IN (VALUES ...)` on PostgreSQL.
    keys = [(r["type"], r["text"]) for r in rows]
    result = await db.execute(
        select(LanguageItem.id, LanguageItem.type, LanguageItem.text).where(
            tuple_(LanguageItem.type, LanguageItem.text).in_(keys)
        )
    )
    by_key = {(row.type, row.text): row.id for row in result}
    return [by_key[(t, txt)] for t, txt in keys]


async def _get_accessible_group(
    group_id: uuid.UUID, account: Account, db: AsyncSession
) -> ItemGroup:
    stmt = select(ItemGroup).where(ItemGroup.id == group_id)
    row = await db.execute(stmt)
    group = row.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Access is allowed if caller owns it OR has active subscription
    if group.owner_account_id == account.id:
        return group

    sub_stmt = select(ItemGroupSubscription).where(
        ItemGroupSubscription.subscriber_account_id == account.id,
        ItemGroupSubscription.source_group_id == group_id,
    )
    sub_row = await db.execute(sub_stmt)
    if sub_row.scalar_one_or_none() is not None:
        return group

    raise HTTPException(status_code=404, detail="Group not found")


async def _require_owned_group(
    group_id: uuid.UUID, account: Account, db: AsyncSession
) -> ItemGroup:
    group = await _get_accessible_group(group_id, account, db)
    if group.owner_account_id != account.id:
        raise HTTPException(status_code=403, detail="CANNOT_EDIT_SUBSCRIBED_GROUP")
    return group


async def _verify_write_permission(
    group: ItemGroup,
    account: Account,
    db: AsyncSession,
    x_role: str | None = None,
) -> None:
    # 1. Subscribed groups are fully read-only
    if group.owner_account_id != account.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CANNOT_EDIT_SUBSCRIBED_GROUP",
        )

    # 2. If locked, only owner (parent) can edit
    is_parent = x_role == "parent"
    if not is_parent and account.last_active_learner_id is not None:
        curr: ItemGroup | None = group
        while curr is not None:
            if curr.locked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="GROUP_LOCKED",
                )
            if curr.parent_id is not None:
                stmt = select(ItemGroup).where(ItemGroup.id == curr.parent_id)
                res = await db.execute(stmt)
                curr = res.scalar_one_or_none()
            else:
                curr = None


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


async def _assemble_tag_path(
    db: AsyncSession,
    account: Account,
    tag_path: list[str],
    active_learner_id: uuid.UUID | None,
    exclude_id: uuid.UUID | None = None,
    level_titles: list[str] | None = None,
) -> tuple[ItemGroup, ItemGroup]:
    """Nest an ordered list of exact tag names into a single-parent tree.

    Walks ``tag_path`` root → leaf. For each name, an existing child under the
    current parent is matched case-insensitively (reuse) or a new node is created.
    Nodes are untyped tags (``kind = "tag"``) — no kind is deduced from depth.
    Returns ``(root, leaf)``. See docs/content-lifecycle.md §4.1, §4.4.

    This is the deterministic, organize-time assembler. It is NOT run at capture
    time and the names come from a human, not from AI inference.
    """
    clean = [t.strip() for t in tag_path if t and t.strip()]
    if not clean:
        raise HTTPException(status_code=400, detail="tag_path cannot be empty")

    curr_parent_id: uuid.UUID | None = None
    root: ItemGroup | None = None
    node: ItemGroup | None = None
    for idx, name in enumerate(clean):
        stmt = select(ItemGroup).where(
            ItemGroup.owner_account_id == account.id,
            ItemGroup.parent_id == curr_parent_id,
            func.lower(func.trim(ItemGroup.name)) == name.lower(),
            ItemGroup.archived.is_(False),
        )
        if exclude_id is not None:
            stmt = stmt.where(ItemGroup.id != exclude_id)
        node = (await db.execute(stmt)).scalar_one_or_none()

        curr_level_title = None
        if level_titles and idx < len(level_titles):
            curr_level_title = level_titles[idx].strip() or None

        if node is None:
            node = ItemGroup(
                name=name,
                kind="tag",
                parent_id=curr_parent_id,
                owner_account_id=account.id,
                created_by_learner_id=active_learner_id,
                last_edited_by_learner_id=active_learner_id,
                level_title=curr_level_title,
            )
            db.add(node)
            await db.flush()
        else:
            if curr_level_title is not None:
                node.level_title = curr_level_title

        curr_parent_id = node.id
        if root is None:
            root = node

    assert root is not None and node is not None  # clean is non-empty
    return root, node


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
            level_title=g.level_title,
        )
        for g in groups
    ]


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    body: GroupCreate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> GroupOut:
    x_role = request.headers.get("x-role")
    active_learner_id = account.last_active_learner_id

    if body.tag_path:
        # Organize-time tree assembly from human-confirmed exact tags (§4.4).
        root, group = await _assemble_tag_path(
            db,
            account,
            body.tag_path,
            active_learner_id,
            level_titles=body.level_titles,
        )
        # Bind optional attributes to the leaf node.
        if body.prompt_notes:
            group.prompt_notes = body.prompt_notes
        if body.source_book_hint:
            group.source_book_hint = body.source_book_hint
    else:
        if body.parent_id is not None:
            parent = await _get_accessible_group(body.parent_id, account, db)
            await _verify_write_permission(parent, account, db, x_role=x_role)

        level_title = None
        if body.level_titles and len(body.level_titles) > 0:
            level_title = body.level_titles[0].strip() or None

        ingestion_batch_id = None
        if body.source_raw_text or body.media_urls:
            batch = IngestionBatch(
                source_type="image" if body.media_urls else "text",
                source_raw_text=body.source_raw_text,
                media_urls=body.media_urls or [],
            )
            db.add(batch)
            await db.flush()
            ingestion_batch_id = batch.id

        group = ItemGroup(
            name=body.name.strip(),
            kind=body.kind,
            parent_id=body.parent_id,
            owner_account_id=account.id,
            prompt_notes=(body.prompt_notes or None),
            source_book_hint=(body.source_book_hint or None),
            created_by_learner_id=active_learner_id,
            last_edited_by_learner_id=active_learner_id,
            level_title=level_title,
            ingestion_batch_id=ingestion_batch_id,
        )
        db.add(group)
        await db.flush()
        root = group

    # Auto-assign the ROOT of this tree to the active learner. Idempotent: a
    # tag_path may reuse an existing root that is already assigned.
    if root.parent_id is None and active_learner_id is not None:
        await db.execute(
            pg_insert(ItemGroupLearner)
            .values(group_id=root.id, learner_id=active_learner_id)
            .on_conflict_do_nothing(index_elements=["group_id", "learner_id"])
        )

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
        level_title=group.level_title,
    )


@router.get("/groups/{group_id}", response_model=GroupDetailOut)
async def get_group(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    recursive: bool = False,
) -> GroupDetailOut:
    group = await _get_accessible_group(group_id, account, db)

    if recursive:
        from app.storage.models.content import get_descendant_group_ids

        descendant_ids = await get_descendant_group_ids(db, group_id)
        stmt = (
            select(LanguageItem, ItemGroup.name, ItemGroup.id)
            .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
            .join(ItemGroup, ItemGroup.id == ItemGroupMember.group_id)
            .where(ItemGroupMember.group_id.in_(descendant_ids))
            .order_by(LanguageItem.type, LanguageItem.text)
        )
        result = await db.execute(stmt)
        rows = result.all()
        items_out = [
            LanguageItemOut(
                id=item.id,
                type=item.type,
                text=item.text,
                anchor=item.anchor,
                cefr_level=item.cefr_level,
                pos=item.pos,
                source_group_name=g_name if g_id != group.id else None,
                source_group_id=g_id if g_id != group.id else None,
            )
            for item, g_name, g_id in rows
        ]
    else:
        leaf_stmt = (
            select(LanguageItem)
            .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
            .where(ItemGroupMember.group_id == group.id)
            .order_by(LanguageItem.type, LanguageItem.text)
        )
        items = list((await db.execute(leaf_stmt)).scalars().all())
        items_out = [
            LanguageItemOut(
                id=item.id,
                type=item.type,
                text=item.text,
                anchor=item.anchor,
                cefr_level=item.cefr_level,
                pos=item.pos,
            )
            for item in items
        ]

    return GroupDetailOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        parent_id=group.parent_id,
        archived=group.archived,
        source_book_hint=group.source_book_hint,
        prompt_notes=group.prompt_notes,
        level_title=group.level_title,
        items=items_out,
    )


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: uuid.UUID,
    body: GroupUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> GroupOut:
    group = await _get_accessible_group(group_id, account, db)
    x_role = request.headers.get("x-role")
    await _verify_write_permission(group, account, db, x_role=x_role)

    update_data = body.model_dump(exclude_unset=True)

    if "tag_path" in update_data and update_data["tag_path"] is not None:
        clean = [t.strip() for t in update_data["tag_path"] if t.strip()]
        if not clean:
            raise HTTPException(status_code=400, detail="tag_path cannot be empty if specified")

        # Last element renames this group; preceding elements (re)build its
        # ancestor chain via the shared assembler (excluding this group itself).
        if len(clean) > 1:
            _, parent_leaf = await _assemble_tag_path(
                db,
                account,
                clean[:-1],
                account.last_active_learner_id,
                exclude_id=group.id,
                level_titles=body.level_titles,
            )
            group.parent_id = parent_leaf.id
        else:
            group.parent_id = None
        group.name = clean[-1]
        group.kind = "tag"

        # Apply level title for the current group node
        if body.level_titles and len(clean) <= len(body.level_titles):
            group.level_title = body.level_titles[len(clean) - 1].strip() or None
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
                parent = await _get_accessible_group(p_id, account, db)
                await _verify_write_permission(parent, account, db, x_role=x_role)
                if await _check_cycle(db, group.id, p_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Circular parent relationship detected",
                    )
            group.parent_id = p_id

        if "level_titles" in update_data and update_data["level_titles"] is not None:
            # In the non-tag_path branch, level_titles applies only to *this* node;
            # only [0] is meaningful. Callers MUST NOT pass more than one entry here
            # (that would be a misuse — multi-level titles belong to the tag_path branch).
            titles = update_data["level_titles"]
            if len(titles) > 1:
                raise HTTPException(
                    status_code=400,
                    detail="level_titles may have at most 1 entry when tag_path is not provided.",
                )
            group.level_title = (titles[0].strip() or None) if titles else None

    if "archived" in update_data:
        group.archived = update_data["archived"]
    if "source_book_hint" in update_data:
        group.source_book_hint = update_data["source_book_hint"] or None
    if "prompt_notes" in update_data:
        group.prompt_notes = update_data["prompt_notes"] or None

    # Handle IngestionBatch update in update_group
    if "source_raw_text" in update_data or "media_urls" in update_data:
        raw_text = update_data.get("source_raw_text")
        urls = update_data.get("media_urls")
        if group.ingestion_batch_id is not None:
            batch = (
                await db.execute(
                    select(IngestionBatch).where(IngestionBatch.id == group.ingestion_batch_id)
                )
            ).scalar_one_or_none()
            if batch:
                if "source_raw_text" in update_data:
                    batch.source_raw_text = raw_text
                if "media_urls" in update_data:
                    batch.media_urls = urls or []
        elif raw_text or urls:
            batch = IngestionBatch(
                source_type="image" if urls else "text",
                source_raw_text=raw_text,
                media_urls=urls or [],
            )
            db.add(batch)
            await db.flush()
            group.ingestion_batch_id = batch.id

    if "items" in update_data:
        await db.execute(delete(ItemGroupMember).where(ItemGroupMember.group_id == group.id))
        item_ids = await _upsert_language_items(db, body.items or [])
        if item_ids:
            await db.execute(
                pg_insert(ItemGroupMember)
                .values([{"group_id": group.id, "item_id": iid} for iid in set(item_ids)])
                .on_conflict_do_nothing(index_elements=["group_id", "item_id"])
            )

    if account.last_active_learner_id is not None:
        group.last_edited_by_learner_id = account.last_active_learner_id

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
        level_title=group.level_title,
    )


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_group(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> None:
    group = await _get_accessible_group(group_id, account, db)
    x_role = request.headers.get("x-role")
    await _verify_write_permission(group, account, db, x_role=x_role)
    await db.delete(group)
    await db.commit()


# ── Learner assignment endpoints ────────────────────────────────────────────────────
#
# Design doc: docs/learner-content-scope.md §8.3
# These endpoints manage item_group_learner rows — which learners can see a root group.
# The group MUST be a root group (parent_id IS NULL); sub-groups inherit from the root.


@router.get("/groups/{group_id}/learners", response_model=list[LearnerAssignmentOut])
async def list_group_learners(
    group_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[LearnerAssignmentOut]:
    """List all learners currently assigned to this group."""
    group = await _get_accessible_group(group_id, account, db)

    rows = list(
        (await db.execute(select(ItemGroupLearner).where(ItemGroupLearner.group_id == group.id)))
        .scalars()
        .all()
    )
    return [
        LearnerAssignmentOut(
            learner_id=row.learner_id,
            assigned_at=row.assigned_at.isoformat(),
        )
        for row in rows
    ]


class AssignLearnerBody(BaseModel):
    learner_id: uuid.UUID


@router.post(
    "/groups/{group_id}/learners",
    response_model=LearnerAssignmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def assign_learner(
    group_id: uuid.UUID,
    body: AssignLearnerBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerAssignmentOut:
    """Assign a learner to a root group."""
    group = await _get_accessible_group(group_id, account, db)

    # Only root groups can be assigned
    if group.parent_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Only root groups (parent_id IS NULL) support learner assignment.",
        )

    # Validate learner belongs to the same account
    learner_row = await db.execute(
        select(Learner).where(
            Learner.id == body.learner_id,
            Learner.account_id == account.id,
        )
    )
    learner = learner_row.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found in this account.")

    # Upsert: ignore if already assigned (PK conflict)
    stmt = (
        pg_insert(ItemGroupLearner)
        .values(group_id=group.id, learner_id=learner.id)
        .on_conflict_do_nothing(index_elements=["group_id", "learner_id"])
        .returning(ItemGroupLearner.learner_id, ItemGroupLearner.assigned_at)
    )
    result = await db.execute(stmt)
    row = result.one_or_none()
    await db.commit()

    if row:
        return LearnerAssignmentOut(
            learner_id=row.learner_id,
            assigned_at=row.assigned_at.isoformat(),
        )
    # Already existed — fetch and return the existing row
    existing = (
        await db.execute(
            select(ItemGroupLearner).where(
                ItemGroupLearner.group_id == group.id,
                ItemGroupLearner.learner_id == learner.id,
            )
        )
    ).scalar_one()
    return LearnerAssignmentOut(
        learner_id=existing.learner_id,
        assigned_at=existing.assigned_at.isoformat(),
    )


@router.delete(
    "/groups/{group_id}/learners/{learner_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def unassign_learner(
    group_id: uuid.UUID,
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Remove a learner from a root group's assignment list."""
    group = await _get_accessible_group(group_id, account, db)

    result = await db.execute(
        delete(ItemGroupLearner).where(
            ItemGroupLearner.group_id == group.id,
            ItemGroupLearner.learner_id == learner_id,
        )
    )
    if cast("CursorResult[Any]", result).rowcount == 0:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    await db.commit()


# ── Organize workbench (docs/content-lifecycle.md §4) ────────────────────────
#
# The inbox of the ACTIVE learner has two sources of loose items:
#   1. capture bags  — kind="quick_practice" groups assigned to the learner.
#   2. practice-derived candidates — words the child said in turns (turn.text_user)
#      that are not yet represented anywhere in the account's content (§4.3).
# Filing MOVES a word into a canonical tag node (add member to target, remove from
# the source capture bag). Practice candidates are not LanguageItems yet — filing
# one lazily creates it. Nothing here writes a new table; word data stays derived
# from turn text (Rule #3).

_CAPTURE_KIND = "quick_practice"

#: Ultra-common function words are noise as "words worth filing"; filtered out of
#: practice-derived candidates. Deliberately small and conservative.
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "so",
        "if",
        "of",
        "to",
        "in",
        "on",
        "at",
        "by",
        "for",
        "with",
        "from",
        "as",
        "is",
        "am",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "do",
        "does",
        "did",
        "have",
        "has",
        "had",
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "me",
        "him",
        "her",
        "us",
        "them",
        "my",
        "your",
        "his",
        "its",
        "our",
        "their",
        "this",
        "that",
        "these",
        "those",
        "what",
        "who",
        "how",
        "why",
        "when",
        "where",
        "yes",
        "no",
        "not",
        "can",
        "will",
        "would",
        "ok",
        "okay",
        "hi",
        "hello",
        "oh",
        "um",
        "uh",
    }
)

_WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")

#: Cap the candidate payload; the long tail of one-off words is rarely worth filing.
_MAX_CANDIDATES = 200


def _tokenize_words(text: str) -> list[str]:
    """Lowercase alphabetic word tokens (contractions kept). Pure."""
    return _WORD_RE.findall(text.lower())


class InboxBag(BaseModel):
    """A capture bag — the UNIT of organizing. The whole bag is filed at once."""

    group_id: uuid.UUID
    name: str
    items: list[LanguageItemOut]
    level_title: str | None = None
    ingestion_batch_id: uuid.UUID | None = None
    source_raw_text: str | None = None
    media_urls: list[str] = Field(default_factory=list)


class InboxCandidate(BaseModel):
    text: str
    count: int  # times the child said it across their turns


class InboxOut(BaseModel):
    learner_id: uuid.UUID | None
    capture_bags: list[InboxBag]
    practice_candidates: list[InboxCandidate]


async def _active_learner_capture_bags(account: Account, db: AsyncSession) -> list[ItemGroup]:
    """Non-empty capture bags assigned to the account's active learner."""
    learner_id = account.last_active_learner_id
    if learner_id is None:
        return []
    return list(
        (
            await db.execute(
                select(ItemGroup)
                .join(ItemGroupLearner, ItemGroupLearner.group_id == ItemGroup.id)
                .where(
                    ItemGroup.owner_account_id == account.id,
                    ItemGroup.kind == _CAPTURE_KIND,
                    ItemGroup.archived.is_(False),
                    ItemGroupLearner.learner_id == learner_id,
                )
                .order_by(ItemGroup.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


@router.get("/organize/inbox", response_model=InboxOut)
async def organize_inbox(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InboxOut:
    """Loose items awaiting organizing, for the account's active learner.

    The unit is the capture *bag* (one ingest), not the individual word: the whole
    bag is filed at once (see ``/organize/suggest-bag`` and ``/organize/file-bag``).
    """
    learner_id = account.last_active_learner_id
    if learner_id is None:
        return InboxOut(learner_id=None, capture_bags=[], practice_candidates=[])

    # 1. Capture bags (grouped) assigned to the active learner.
    bags = await _active_learner_capture_bags(account, db)

    # Batch query IngestionBatches
    batch_ids = [b.ingestion_batch_id for b in bags if b.ingestion_batch_id is not None]
    batches_by_id = {}
    if batch_ids:
        batch_rows = (
            (await db.execute(select(IngestionBatch).where(IngestionBatch.id.in_(batch_ids))))
            .scalars()
            .all()
        )
        batches_by_id = {batch.id: batch for batch in batch_rows}

    items_by_bag: dict[uuid.UUID, list[LanguageItemOut]] = {b.id: [] for b in bags}
    if bags:
        rows = (
            await db.execute(
                select(ItemGroupMember.group_id, LanguageItem)
                .join(LanguageItem, LanguageItem.id == ItemGroupMember.item_id)
                .where(ItemGroupMember.group_id.in_([b.id for b in bags]))
                .order_by(LanguageItem.type, LanguageItem.text)
            )
        ).all()
        for gid, item in rows:
            items_by_bag[gid].append(
                LanguageItemOut(
                    id=item.id,
                    type=item.type,
                    text=item.text,
                    anchor=item.anchor,
                    cefr_level=item.cefr_level,
                    pos=item.pos,
                )
            )
    capture_bags = []
    for b in bags:
        if not items_by_bag[b.id]:
            continue
        batch = batches_by_id.get(b.ingestion_batch_id) if b.ingestion_batch_id else None
        capture_bags.append(
            InboxBag(
                group_id=b.id,
                name=b.name,
                items=items_by_bag[b.id],
                level_title=b.level_title,
                ingestion_batch_id=b.ingestion_batch_id,
                source_raw_text=batch.source_raw_text if batch else None,
                media_urls=batch.media_urls if batch else [],
            )
        )

    # 2. Practice-derived candidates: words the child said, not yet anywhere in
    #    the account's content. Derived from turn text — no separate event table.
    #
    # Count per-word occurrences across turns first, then do a single NOT EXISTS
    # check in the DB — avoids pulling the entire account vocabulary into Python.
    counts: dict[str, int] = {}
    user_texts = (
        await db.execute(select(Turn.text_user).where(Turn.learner_id == learner_id))
    ).all()
    for (text_user,) in user_texts:
        for word in _tokenize_words(text_user or ""):
            if len(word) < 2 or word in _STOPWORDS:
                continue
            counts[word] = counts.get(word, 0) + 1

    # Filter out words already stored anywhere in the account's content.
    # Subquery approach: one DB round-trip to look up only the candidate set.
    candidate_words = list(counts.keys())
    existing_texts: set[str] = set()
    if candidate_words:
        existing_rows = (
            await db.execute(
                select(LanguageItem.text)
                .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
                .join(ItemGroup, ItemGroup.id == ItemGroupMember.group_id)
                .where(
                    ItemGroup.owner_account_id == account.id,
                    func.lower(LanguageItem.text).in_(candidate_words),
                )
            )
        ).all()
        existing_texts = {t.lower() for (t,) in existing_rows}

    # Remove words already present anywhere in the account's content.
    filtered = {w: c for w, c in counts.items() if w not in existing_texts}
    ranked = sorted(filtered.items(), key=lambda kv: (-kv[1], kv[0]))
    practice_candidates = [InboxCandidate(text=w, count=c) for w, c in ranked[:_MAX_CANDIDATES]]

    return InboxOut(
        learner_id=learner_id,
        capture_bags=capture_bags,
        practice_candidates=practice_candidates,
    )


class FileItemBody(BaseModel):
    target_group_id: uuid.UUID
    #: Move an existing captured item: supply item_id (+ source_group_id to remove from).
    item_id: uuid.UUID | None = None
    source_group_id: uuid.UUID | None = None
    #: Or file a practice candidate: supply the new item to lazily create.
    new_item: ItemIn | None = None


@router.post("/organize/file", response_model=LanguageItemOut)
async def organize_file(
    body: FileItemBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> LanguageItemOut:
    """File one loose word into a target tag node (MOVE semantics).

    Adds the item to the target (idempotent); if ``source_group_id`` is given, also
    removes it from that capture bag so the inbox shrinks as you organize.
    """
    x_role = request.headers.get("x-role")
    target = await _get_accessible_group(body.target_group_id, account, db)
    await _verify_write_permission(target, account, db, x_role=x_role)

    if body.new_item is not None:
        item_id = (await _upsert_language_items(db, [body.new_item]))[0]
    elif body.item_id is not None:
        item_id = body.item_id
    else:
        raise HTTPException(status_code=400, detail="Provide item_id or new_item.")

    await db.execute(
        pg_insert(ItemGroupMember)
        .values(group_id=target.id, item_id=item_id)
        .on_conflict_do_nothing(index_elements=["group_id", "item_id"])
    )

    if body.source_group_id is not None and body.source_group_id != target.id:
        source = await _get_accessible_group(body.source_group_id, account, db)
        await _verify_write_permission(source, account, db, x_role=x_role)
        await db.execute(
            delete(ItemGroupMember).where(
                ItemGroupMember.group_id == source.id,
                ItemGroupMember.item_id == item_id,
            )
        )

    if account.last_active_learner_id is not None:
        target.last_edited_by_learner_id = account.last_active_learner_id

    await db.commit()

    item = (await db.execute(select(LanguageItem).where(LanguageItem.id == item_id))).scalar_one()
    return LanguageItemOut(
        id=item.id,
        type=item.type,
        text=item.text,
        anchor=item.anchor,
        cefr_level=item.cefr_level,
        pos=item.pos,
    )


class DismissItemBody(BaseModel):
    group_id: uuid.UUID
    item_id: uuid.UUID


@router.post("/organize/dismiss", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def organize_dismiss(
    body: DismissItemBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> None:
    """Drop a captured item from its bag (it leaves the inbox; the LanguageItem row
    stays — it may be referenced elsewhere)."""
    group = await _get_accessible_group(body.group_id, account, db)
    await _verify_write_permission(group, account, db, x_role=request.headers.get("x-role"))
    await db.execute(
        delete(ItemGroupMember).where(
            ItemGroupMember.group_id == group.id,
            ItemGroupMember.item_id == body.item_id,
        )
    )
    await db.commit()


# ── Bag-level organizing (whole capture bag at once + AI-suggested placement) ──
#
# Picking words one by one is tedious; the unit of organizing is the bag. The AI
# proposes a tag path (default = the bag's name); the human tweaks it and files the
# whole bag in one move. This is organize-time AI-assisted curation (human confirms),
# not capture-time inference — see docs/content-lifecycle.md §5/§6.


def _path_of(group: ItemGroup, by_id: dict[uuid.UUID, ItemGroup]) -> str:
    names: list[str] = []
    cur: ItemGroup | None = group
    seen: set[uuid.UUID] = set()
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        names.append(cur.name)
        cur = by_id.get(cur.parent_id) if cur.parent_id is not None else None
    return " › ".join(reversed(names))  # noqa: RUF001 (intentional UI path separator)


LEVEL_PRESETS = [
    "教材",
    "单元",
    "课次",
    "小节",
    "知识点",
    "册次",
    "级别",
    "分类",
    "考试",
    "科目",
    "模块",
    "题型",
    "专项",
    "任务",
    "分级",
]

_SUGGEST_PROMPT = f"""You organize a child's English learning materials into a tag tree \
(textbook → book → unit → lesson, variable depth). Given a freshly captured set of words \
and the family's EXISTING tag paths, return the single best tag path to file this set under, \
along with a corresponding child-friendly semantic level title for each tag.

Preferred Level Titles:
Choose or prioritize level titles from this list if they fit: {", ".join(LEVEL_PRESETS)}.
However, you are free to expand or suggest other child-friendly or contextually appropriate \
terms if none of the presets fit (e.g. "Part", "Section", "Task" or custom book divisions).

Rules:
- Strongly prefer extending an EXISTING path (reuse exact tag names) when the content fits.
- Otherwise propose a sensible new path (2-4 tags, e.g. ["Tot Talk", "Book 1", "Unit 3"]).
- Provide a clear, child-friendly level title for each path segment (e.g. ["教材", "单元"]).
- Return ONLY JSON: {{"tag_path": ["...", "..."], "level_titles": ["...", "..."]}}. \
No prose, no fences."""


class SuggestBagBody(BaseModel):
    group_id: uuid.UUID


class SuggestBagOut(BaseModel):
    tag_path: list[str]
    level_titles: list[str] | None = None
    source: Literal["ai", "default"]


@router.post("/organize/suggest-bag", response_model=SuggestBagOut)
async def organize_suggest_bag(
    body: SuggestBagBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuggestBagOut:
    """Predict where a capture bag should be filed. Falls back to the bag's own name."""
    bag = await _require_owned_group(body.group_id, account, db)
    default = SuggestBagOut(
        tag_path=[bag.name.strip() or "未分类"],
        level_titles=[bag.level_title or "教材"],
        source="default",
    )

    words = [
        t
        for (t,) in (
            await db.execute(
                select(LanguageItem.text)
                .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
                .where(ItemGroupMember.group_id == bag.id)
                .limit(60)
            )
        ).all()
    ]
    if not words:
        return default

    canonical = list(
        (
            await db.execute(
                select(ItemGroup).where(
                    ItemGroup.owner_account_id == account.id,
                    ItemGroup.kind != _CAPTURE_KIND,
                    ItemGroup.archived.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {g.id: g for g in canonical}
    existing_paths = sorted({_path_of(g, by_id) for g in canonical})
    existing_block = "\n".join(f"- {p}" for p in existing_paths) or "(none yet)"

    prompt = (
        f"{_SUGGEST_PROMPT}\n\n"
        f"--- EXISTING TAG PATHS ---\n{existing_block}\n\n"
        f"--- CAPTURED SET ---\n"
        f"name: {bag.name}\nwords: {', '.join(words[:60])}\n"
    )
    try:
        naming = app_config.task("group_naming")
        resp = await factory.chat.invoke(
            [LLMMessage(role="user", content=prompt)],
            max_tokens=naming.max_tokens,
            temperature=naming.temperature,
        )
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", resp.text.strip())
        data = json.loads(text)
        tag_path = [str(s).strip() for s in data.get("tag_path", []) if str(s).strip()]
        level_titles = [str(s).strip() for s in data.get("level_titles", []) if str(s).strip()]
        if tag_path:
            # Cap tag_path first; then align level_titles to the same length so
            # they never have more entries than the returned path segments.
            clean_tag_path = tag_path[:6]
            return SuggestBagOut(
                tag_path=clean_tag_path,
                level_titles=level_titles[: len(clean_tag_path)] if level_titles else None,
                source="ai",
            )
    except Exception:
        log.warning("organize suggest-bag: LLM suggestion failed, using default", exc_info=True)
    return default


class FileBagBody(BaseModel):
    source_group_id: uuid.UUID
    tag_path: list[str]
    archive_emptied: bool = True
    level_titles: list[str] | None = None
    source_raw_text: str | None = None


class FileBagOut(BaseModel):
    target_group_id: uuid.UUID
    moved: int


@router.post("/organize/file-bag", response_model=FileBagOut)
async def organize_file_bag(
    body: FileBagBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> FileBagOut:
    """Move ALL items of a capture bag into the tag_path leaf, then archive the bag."""
    x_role = request.headers.get("x-role")
    source = await _get_accessible_group(body.source_group_id, account, db)
    await _verify_write_permission(source, account, db, x_role=x_role)

    clean = [t.strip() for t in body.tag_path if t.strip()]
    if not clean:
        raise HTTPException(status_code=400, detail="tag_path cannot be empty")

    _, leaf = await _assemble_tag_path(
        db,
        account,
        clean,
        account.last_active_learner_id,
        level_titles=body.level_titles,
    )
    # Verify the target leaf is writable (respects lock chain on existing nodes).
    await _verify_write_permission(leaf, account, db, x_role=x_role)

    # IngestionBatch creation/updating/inheritance logic
    ingestion_batch_id = source.ingestion_batch_id
    if body.source_raw_text is not None:
        if ingestion_batch_id is not None:
            # If batch already existed, update its text
            batch = (
                await db.execute(
                    select(IngestionBatch).where(IngestionBatch.id == ingestion_batch_id)
                )
            ).scalar_one_or_none()
            if batch:
                batch.source_raw_text = body.source_raw_text
        else:
            # Create a new batch
            batch = IngestionBatch(
                source_type="text",
                source_raw_text=body.source_raw_text,
                media_urls=[],
            )
            db.add(batch)
            await db.flush()
            ingestion_batch_id = batch.id
            source.ingestion_batch_id = ingestion_batch_id

    if ingestion_batch_id is not None:
        leaf.ingestion_batch_id = ingestion_batch_id

    item_ids = [
        i
        for (i,) in (
            await db.execute(
                select(ItemGroupMember.item_id).where(ItemGroupMember.group_id == source.id)
            )
        ).all()
    ]
    if item_ids:
        await db.execute(
            pg_insert(ItemGroupMember)
            .values([{"group_id": leaf.id, "item_id": iid} for iid in item_ids])
            .on_conflict_do_nothing(index_elements=["group_id", "item_id"])
        )
        await db.execute(delete(ItemGroupMember).where(ItemGroupMember.group_id == source.id))

    if body.archive_emptied:
        source.archived = True
    if account.last_active_learner_id is not None:
        leaf.last_edited_by_learner_id = account.last_active_learner_id

    await db.commit()
    return FileBagOut(target_group_id=leaf.id, moved=len(item_ids))
