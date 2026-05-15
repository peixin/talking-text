from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope.protocol import PatternItem, ScopeResult
from app.storage.models.collection import Collection, CollectionItem
from app.storage.models.curriculum import CurriculumLesson, LanguageItem, LessonItem


class V1ScopeComputer:
    """Lesson-based scope: queries language items for a given lesson_id."""

    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        lesson_id: uuid.UUID | None,
        collection_id: uuid.UUID | None,
    ) -> ScopeResult:
        if collection_id is not None:
            # Fetch items from the specified collection
            items_row = await db.execute(
                select(LanguageItem)
                .join(CollectionItem, CollectionItem.item_id == LanguageItem.id)
                .where(CollectionItem.collection_id == collection_id)
                .order_by(LanguageItem.type, LanguageItem.text)
            )
            items = list(items_row.scalars().all())

            # Optional: Fetch collection description for prompt context
            coll_row = await db.execute(select(Collection).where(Collection.id == collection_id))
            collection = coll_row.scalar_one_or_none()
            description = collection.description if collection else None

            return ScopeResult(
                words=[i.text for i in items if i.type == "word"],
                phrases=[i.text for i in items if i.type == "phrase"],
                patterns=[
                    PatternItem(text=i.text, anchor=i.anchor) for i in items if i.type == "pattern"
                ],
                prompt_notes=description,
            )

        if lesson_id is None:
            return ScopeResult()

        lesson_row = await db.execute(
            select(CurriculumLesson).where(CurriculumLesson.id == lesson_id)
        )
        lesson = lesson_row.scalar_one_or_none()
        if lesson is None:
            return ScopeResult()

        items_row = await db.execute(
            select(LanguageItem)
            .join(LessonItem, LessonItem.item_id == LanguageItem.id)
            .where(LessonItem.lesson_id == lesson_id)
            .order_by(LanguageItem.type, LanguageItem.text)
        )
        items = list(items_row.scalars().all())

        return ScopeResult(
            words=[i.text for i in items if i.type == "word"],
            phrases=[i.text for i in items if i.type == "phrase"],
            patterns=[
                PatternItem(text=i.text, anchor=i.anchor) for i in items if i.type == "pattern"
            ],
            prompt_notes=lesson.prompt_notes,
            focus_instructions=lesson.focus_instructions,
        )
