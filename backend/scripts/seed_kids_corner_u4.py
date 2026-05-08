"""One-time seed: Kids Corner Book 1 — Starter Unit 4 (Lessons 1 & 2).

Run from repo root:
    just be run python scripts/seed_kids_corner_u4.py
"""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.db import _SessionFactory
from app.storage.models.curriculum import (
    Curriculum,
    CurriculumLesson,
    CurriculumUnit,
    LanguageItem,
    LessonItem,
)


async def upsert_item(db: AsyncSession, *, type_: str, text: str, anchor: str) -> uuid.UUID:
    stmt = (
        insert(LanguageItem)
        .values(id=uuid.uuid4(), type=type_, text=text, anchor=anchor)
        .on_conflict_do_update(
            constraint="uq_language_item_type_text",
            set_={"anchor": anchor},
        )
        .returning(LanguageItem.id)
    )
    result = await db.execute(stmt)
    return result.scalar_one()


async def seed() -> None:
    async with _SessionFactory() as db:
        # ── Curriculum ───────────────────────────────────────────────────────
        row = await db.execute(select(Curriculum).where(Curriculum.name == "Kids Corner Book 1"))
        curriculum = row.scalar_one_or_none()
        if curriculum is None:
            curriculum = Curriculum(
                id=uuid.uuid4(),
                name="Kids Corner Book 1",
                publisher="Cambridge",
                is_public=True,
            )
            db.add(curriculum)
            await db.flush()
        print(f"Curriculum: {curriculum.id}")

        # ── Unit ─────────────────────────────────────────────────────────────
        row = await db.execute(
            select(CurriculumUnit).where(
                CurriculumUnit.curriculum_id == curriculum.id,
                CurriculumUnit.unit_number == "Starter Unit 4",
            )
        )
        unit = row.scalar_one_or_none()
        if unit is None:
            unit = CurriculumUnit(
                id=uuid.uuid4(),
                curriculum_id=curriculum.id,
                sequence=4,
                unit_number="Starter Unit 4",
                title="A New Adventure",
            )
            db.add(unit)
            await db.flush()
        print(f"Unit: {unit.id}")

        # ── Lesson 1 ─────────────────────────────────────────────────────────
        row = await db.execute(
            select(CurriculumLesson).where(
                CurriculumLesson.unit_id == unit.id,
                CurriculumLesson.sequence == 1,
            )
        )
        lesson1 = row.scalar_one_or_none()
        if lesson1 is None:
            lesson1 = CurriculumLesson(
                id=uuid.uuid4(),
                unit_id=unit.id,
                sequence=1,
                title="Lesson 1",
                prompt_notes=None,
                focus_instructions=(
                    "Topic: colors. Ask 'What colors do you like?' early. "
                    "Encourage 'I like ___ and ___.' with color words. "
                    "If the child names one color, say: 'What else? I like red AND...' "
                    "to prompt the pattern."
                ),
            )
            db.add(lesson1)
            await db.flush()
        print(f"Lesson 1: {lesson1.id}")

        lesson1_words = [
            "red",
            "yellow",
            "blue",
            "green",
            "orange",
            "brown",
            "pink",
            "purple",
            "black",
            "white",
        ]
        lesson1_patterns = [
            ("What colors do you like?", "what colors do you like"),
            ("I like ___ and ___.", "i like"),
        ]

        for word in lesson1_words:
            item_id = await upsert_item(db, type_="word", text=word, anchor=word)
            stmt = (
                insert(LessonItem)
                .values(lesson_id=lesson1.id, item_id=item_id)
                .on_conflict_do_nothing()
            )
            await db.execute(stmt)

        for text, anchor in lesson1_patterns:
            item_id = await upsert_item(db, type_="pattern", text=text, anchor=anchor)
            stmt = (
                insert(LessonItem)
                .values(lesson_id=lesson1.id, item_id=item_id)
                .on_conflict_do_nothing()
            )
            await db.execute(stmt)

        # ── Lesson 2 ─────────────────────────────────────────────────────────
        row = await db.execute(
            select(CurriculumLesson).where(
                CurriculumLesson.unit_id == unit.id,
                CurriculumLesson.sequence == 2,
            )
        )
        lesson2 = row.scalar_one_or_none()
        if lesson2 is None:
            lesson2 = CurriculumLesson(
                id=uuid.uuid4(),
                unit_id=unit.id,
                sequence=2,
                title="Lesson 2",
                prompt_notes=(
                    "Use 'has' for he/she (third person singular); "
                    "'have' for I/you/they. "
                    "Clothing nouns: singular vs plural (a jacket / two jackets). "
                    "'an' before vowel sounds: an orange T-shirt."
                ),
                focus_instructions=(
                    "Topic: describing characters' colorful outfits. "
                    "Create a scenario — monsters or dress-up characters work well. "
                    "Ask: 'What is your monster wearing?' "
                    "Guide: 'He has a [color] [clothing item].' "
                    "If the child names an item without a color, prompt: 'What color is it?'"
                ),
            )
            db.add(lesson2)
            await db.flush()
        print(f"Lesson 2: {lesson2.id}")

        lesson2_words = ["dress", "jacket", "T-shirt", "jeans", "pants", "skirt"]
        lesson2_patterns = [
            ("He/She has a ___ ___.", "has a"),
        ]

        for word in lesson2_words:
            item_id = await upsert_item(db, type_="word", text=word, anchor=word)
            stmt = (
                insert(LessonItem)
                .values(lesson_id=lesson2.id, item_id=item_id)
                .on_conflict_do_nothing()
            )
            await db.execute(stmt)

        for text, anchor in lesson2_patterns:
            item_id = await upsert_item(db, type_="pattern", text=text, anchor=anchor)
            stmt = (
                insert(LessonItem)
                .values(lesson_id=lesson2.id, item_id=item_id)
                .on_conflict_do_nothing()
            )
            await db.execute(stmt)

        await db.commit()
        print("Seed complete.")
        print(f"  Lesson 1 id: {lesson1.id}")
        print(f"  Lesson 2 id: {lesson2.id}")


if __name__ == "__main__":
    asyncio.run(seed())
