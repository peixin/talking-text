"""Sibling-order resolution for "next unit" — shared by scope V2 and mastery.

Curriculum sequence among sibling ItemGroups: explicit ``position`` first
(NULLS LAST), then natural sort on ``name`` so "Unit 2" < "Unit 10". See
docs/phase2-mastery-stretch.md §2 — crossing parents (last lesson of Unit 1
→ first lesson of Unit 2) is deliberately out of scope.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.models.content import (
    ItemGroup,
    ItemGroupMember,
    LanguageItem,
    get_descendant_group_ids,
)

_DIGITS_RE = re.compile(r"(\d+)")


def natural_sort_key(name: str) -> tuple[str | int, ...]:
    """Case-insensitive key treating digit runs as numbers ("Unit 2" < "Unit 10")."""
    parts = _DIGITS_RE.split(name.lower().strip())
    return tuple(int(p) if p.isdigit() else p for p in parts)


def sibling_sort_key(position: int | None, name: str) -> tuple:
    return (position is None, position if position is not None else 0, natural_sort_key(name))


async def next_sibling_group_id(db: AsyncSession, group_id: uuid.UUID) -> uuid.UUID | None:
    """The sibling that follows ``group_id`` in curriculum order, or None.

    None for root groups (no parent → no siblings), the last sibling, and
    groups that no longer exist.
    """
    row = await db.execute(
        select(ItemGroup.parent_id).where(ItemGroup.id == group_id, ItemGroup.archived.is_(False))
    )
    parent_id = row.scalar_one_or_none()
    if parent_id is None:
        return None

    siblings_rows = await db.execute(
        select(ItemGroup.id, ItemGroup.position, ItemGroup.name).where(
            ItemGroup.parent_id == parent_id, ItemGroup.archived.is_(False)
        )
    )
    siblings = sorted(siblings_rows.all(), key=lambda r: sibling_sort_key(r.position, r.name))
    for i, sib in enumerate(siblings):
        if sib.id == group_id:
            return siblings[i + 1].id if i + 1 < len(siblings) else None
    return None


async def next_unit_word_items(db: AsyncSession, group_id: uuid.UUID) -> list[LanguageItem]:
    """Word-type items of the next sibling group's subtree (the stretch pool)."""
    next_id = await next_sibling_group_id(db, group_id)
    if next_id is None:
        return []
    descendant_ids = await get_descendant_group_ids(db, next_id)
    rows = await db.execute(
        select(LanguageItem)
        .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
        .where(ItemGroupMember.group_id.in_(descendant_ids), LanguageItem.type == "word")
        .order_by(LanguageItem.text)
    )
    return list(rows.scalars().all())
