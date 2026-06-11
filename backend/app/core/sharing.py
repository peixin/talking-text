"""Cross-account material sharing — clone (deep copy) of a group subtree.

Design: docs/learner-content-scope.md §6 (UC-5/UC-6), §7.2.

A clone copies the ``item_group`` subtree with fresh UUIDs and re-inserts
``item_group_member`` rows pointing at the SAME global ``language_item`` ids
(items are canonical by (type, text)). Because mastery (``learner_item_stats``)
is keyed by item id, a learner's progress survives a subscribe → fork
transition untouched.

Pure DB orchestration — no external SDKs, no HTTP. Callers commit.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.models.content import (
    GroupAdoption,
    ItemGroup,
    ItemGroupMember,
    get_descendant_group_ids,
)


async def clone_group_tree(
    db: AsyncSession,
    source_root: ItemGroup,
    *,
    new_owner_account_id: uuid.UUID,
    active_learner_id: uuid.UUID | None,
) -> ItemGroup:
    """Deep-copy ``source_root`` and its non-archived descendants to a new owner.

    Returns the new root (flushed, not committed). Copies structure and content
    fields; deliberately does NOT copy: ``ingestion_batch_id`` (capture
    provenance stays with the source account), learner attribution (the clone
    starts a clean slate — §7.2), or ``archived`` subtrees.
    """
    subtree_ids = await get_descendant_group_ids(db, source_root.id)
    rows = (
        (await db.execute(select(ItemGroup).where(ItemGroup.id.in_(subtree_ids)))).scalars().all()
    )
    by_id = {g.id: g for g in rows}

    # Copy nodes parent-before-child (BFS order of get_descendant_group_ids).
    new_ids: dict[uuid.UUID, uuid.UUID] = {}
    new_root: ItemGroup | None = None
    for old_id in subtree_ids:
        src = by_id.get(old_id)
        if src is None:  # archived nodes are excluded from the id walk's source
            continue
        copy = ItemGroup(
            name=src.name,
            kind=src.kind,
            parent_id=new_ids.get(src.parent_id) if src.parent_id else None,
            position=src.position,
            owner_account_id=new_owner_account_id,
            level_title=src.level_title,
            cover_image_url=src.cover_image_url,
            prompt_notes=src.prompt_notes,
            source_book_hint=src.source_book_hint,
            created_by_learner_id=active_learner_id,
            last_edited_by_learner_id=active_learner_id,
            cloned_from_group_id=source_root.id if old_id == source_root.id else None,
        )
        db.add(copy)
        await db.flush()
        new_ids[old_id] = copy.id
        if old_id == source_root.id:
            new_root = copy

    assert new_root is not None  # source_root is always first in subtree_ids

    # Re-point membership rows at the same canonical language_item ids.
    member_rows = (
        await db.execute(
            select(ItemGroupMember.group_id, ItemGroupMember.item_id).where(
                ItemGroupMember.group_id.in_(list(new_ids.keys()))
            )
        )
    ).all()
    for old_gid, item_id in member_rows:
        db.add(ItemGroupMember(group_id=new_ids[old_gid], item_id=item_id))

    db.add(
        GroupAdoption(
            source_group_id=source_root.id,
            target_group_id=new_root.id,
            adopted_by_account_id=new_owner_account_id,
        )
    )
    await db.flush()
    return new_root
