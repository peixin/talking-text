from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope.protocol import PatternItem, ScopeResult
from app.storage.models.content import ItemGroup, ItemGroupMember, LanguageItem
from app.storage.models.learner import Learner


class V1ScopeComputer:
    """Three modes:

    - group       — session anchored to an item_group → return its items
    - calibration — learner has no cefr_level yet → no vocab list, prompt-driven
    - free        — learner has cefr_level → no vocab list, level-anchored
    """

    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        group_id: uuid.UUID | None,
    ) -> ScopeResult:
        learner_row = await db.execute(select(Learner).where(Learner.id == learner_id))
        learner = learner_row.scalar_one_or_none()
        cefr_level = learner.cefr_level if learner else None

        if group_id is not None:
            group_row = await db.execute(select(ItemGroup).where(ItemGroup.id == group_id))
            group = group_row.scalar_one_or_none()
            if group is None:
                # Group was deleted while session referenced it. Fall through to
                # free / calibration mode rather than failing the turn.
                return self._scope_without_group(cefr_level)

            items_row = await db.execute(
                select(LanguageItem)
                .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
                .where(ItemGroupMember.group_id == group_id)
                .order_by(LanguageItem.type, LanguageItem.text)
            )
            items = list(items_row.scalars().all())

            return ScopeResult(
                mode="group",
                cefr_level=cefr_level,
                words=[i.text for i in items if i.type == "word"],
                phrases=[i.text for i in items if i.type == "phrase"],
                patterns=[
                    PatternItem(text=i.text, anchor=i.anchor) for i in items if i.type == "pattern"
                ],
                prompt_notes=group.prompt_notes,
            )

        return self._scope_without_group(cefr_level)

    @staticmethod
    def _scope_without_group(cefr_level: str | None) -> ScopeResult:
        if cefr_level is None:
            return ScopeResult(mode="calibration", cefr_level=None)
        return ScopeResult(mode="free", cefr_level=cefr_level)
