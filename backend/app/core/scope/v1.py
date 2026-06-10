from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope.protocol import PatternItem, ScopeResult
from app.storage.models.content import (
    ItemGroup,
    ItemGroupMember,
    LanguageItem,
    get_descendant_group_ids,
)
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
        session_id: uuid.UUID | None = None,
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

            descendant_ids = await get_descendant_group_ids(db, group_id)
            items_row = await db.execute(
                select(LanguageItem)
                .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
                .where(ItemGroupMember.group_id.in_(descendant_ids))
                .order_by(LanguageItem.type, LanguageItem.text)
            )
            items = list(items_row.scalars().all())

            # Bounded context optimization: if descendant items exceed 100, prioritize
            # and slice items based on learner's mastery statistics.
            if len(items) > 100:
                from app.storage.models.learning import LearnerItemStats

                item_ids = [i.id for i in items]
                stats_row = await db.execute(
                    select(
                        LearnerItemStats.item_id,
                        LearnerItemStats.mastered_at,
                        LearnerItemStats.correct_count,
                    ).where(
                        LearnerItemStats.learner_id == learner_id,
                        LearnerItemStats.item_id.in_(item_ids),
                    )
                )
                stats_map = {
                    row.item_id: (row.mastered_at, row.correct_count) for row in stats_row.all()
                }

                def get_item_score(it: LanguageItem) -> float:
                    stats = stats_map.get(it.id)
                    if stats:
                        mastered_at, correct_count = stats
                        if mastered_at is not None:
                            return 1000.0 + float(correct_count or 0)
                        return float(correct_count or 0)
                    return -1.0

                items.sort(key=get_item_score)
                items = items[:100]

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
