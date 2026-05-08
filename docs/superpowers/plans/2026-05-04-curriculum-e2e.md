# Curriculum End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Kids Corner Book 1 Unit 4 vocabulary + sentence patterns into the chat pipeline so Tina uses the lesson scope in conversation, with a learner home page for managing lessons and a chat banner showing the current lesson.

**Architecture:** New curriculum DB models feed a ScopeComputer that queries lesson items per session; the PromptAssembler converts those items into a structured system prompt replacing the current hardcoded `_SYSTEM_PROMPT`. The frontend adds a learner home page and a lesson banner in the chat UI. Collection path is schema-ready but not implemented.

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 async, Next.js 16 App Router, shadcn/ui, Tailwind v4, PostgreSQL, Alembic, Poetry, pnpm.

---

## File Map

### Backend — New files
- `backend/app/storage/models/curriculum.py` — 7 SQLAlchemy models
- `backend/app/core/scope/protocol.py` — `ScopeResult`, `PatternItem`, `ScopeComputer` Protocol
- `backend/app/core/scope/v1.py` — DB-backed V1 implementation
- `backend/app/core/prompt/assembler.py` — pure `build_system_prompt(scope)` function
- `backend/app/api/curriculum.py` — 5 curriculum + learner-lesson endpoints
- `backend/scripts/seed_kids_corner_u4.py` — one-time seed script
- `backend/tests/__init__.py` — empty
- `backend/tests/test_prompt_assembler.py` — unit tests for assembler

### Backend — Modified files
- `backend/app/storage/models/session.py` — add `lesson_id`, `collection_id`
- `backend/app/storage/models/__init__.py` — export new models
- `backend/app/core/dialog/orchestrator.py` — inject `ScopeComputer`, use `build_system_prompt`
- `backend/app/adapters/factory.py` — instantiate `V1ScopeComputer`
- `backend/app/api/session.py` — `lesson_id` in create + patch; `lesson_id` in `SessionOut`
- `backend/app/api/__init__.py` — register curriculum router

### Frontend — New files
- `frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx` — Server Component shell
- `frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx` — Client Component
- `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts` — Server Actions
- `frontend/components/LessonPickerClient.tsx` — shared dialog for selecting lessons
- `frontend/components/LessonBannerClient.tsx` — chat banner showing current lesson

### Frontend — Modified files
- `frontend/lib/backend.ts` — new types + curriculum/learner-lesson API methods
- `frontend/lib/api.ts` — expose new methods through `createApi()`
- `frontend/app/[locale]/(app)/chat/page.tsx` — pass `lesson_id` when creating session
- `frontend/app/[locale]/(app)/chat/[sessionId]/page.tsx` — pass lesson info to layout
- `frontend/app/[locale]/(app)/chat/[sessionId]/ChatClient.tsx` — add `LessonBannerClient`
- `frontend/app/[locale]/(app)/chat/[sessionId]/actions.ts` — `createSession` accepts `lessonId`

---

## Task 1: Curriculum DB Models

**Files:**
- Create: `backend/app/storage/models/curriculum.py`

- [ ] **Step 1: Write the models file**

```python
# backend/app/storage/models/curriculum.py
from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin


class LanguageItem(Base, TimestampMixin):
    """Atomic learnable unit: word, phrase, or sentence pattern."""

    __tablename__ = "language_item"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(sa.String(10), nullable=False)       # word|phrase|pattern
    text: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    anchor: Mapped[str] = mapped_column(sa.String(200), nullable=False)    # lowercase fixed substring

    __table_args__ = (sa.UniqueConstraint("type", "text", name="uq_language_item_type_text"),)


class Curriculum(Base, TimestampMixin):
    """A textbook or curriculum source (public or private)."""

    __tablename__ = "curriculum"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    publisher: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    is_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default="false")
    owner_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("account.id", ondelete="SET NULL"), nullable=True
    )


class CurriculumUnit(Base, TimestampMixin):
    """A unit within a curriculum (grouping only)."""

    __tablename__ = "curriculum_unit"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    curriculum_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    unit_number: Mapped[str] = mapped_column(sa.String(50), nullable=False)
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)


class CurriculumLesson(Base, TimestampMixin):
    """A single lesson — the smallest practice unit."""

    __tablename__ = "curriculum_lesson"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_unit.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    prompt_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    focus_instructions: Mapped[str | None] = mapped_column(sa.Text, nullable=True)


class LessonItem(Base, TimestampMixin):
    """Many-to-many: lesson ↔ language_item."""

    __tablename__ = "lesson_item"

    lesson_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_lesson.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )


class LearnerLesson(Base, TimestampMixin):
    """Append-only log: learner has studied this lesson."""

    __tablename__ = "learner_lesson"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("curriculum_lesson.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )


class LearnerItemStats(Base, TimestampMixin):
    """Per-learner mastery tracking for language items (schema-only in V1)."""

    __tablename__ = "learner_item_stats"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("learner.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("language_item.id", ondelete="CASCADE"), nullable=False, primary_key=True
    )
    seen_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    used_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    correct_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")
    last_seen: Mapped[sa.DateTime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
```

- [ ] **Step 2: Export new models in `__init__.py`**

Replace the content of `backend/app/storage/models/__init__.py`:

```python
from app.storage.models.account import Account
from app.storage.models.account_credential import AccountCredential
from app.storage.models.curriculum import (
    Curriculum,
    CurriculumLesson,
    CurriculumUnit,
    LanguageItem,
    LearnerItemStats,
    LearnerLesson,
    LessonItem,
)
from app.storage.models.learner import Learner
from app.storage.models.session import Session
from app.storage.models.turn import Turn

__all__ = [
    "Account",
    "AccountCredential",
    "Curriculum",
    "CurriculumLesson",
    "CurriculumUnit",
    "LanguageItem",
    "LearnerItemStats",
    "LearnerLesson",
    "LessonItem",
    "Learner",
    "Session",
    "Turn",
]
```

- [ ] **Step 3: Run mypy to verify types**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just typecheck 2>&1 | head -30
```

Expected: no new errors from curriculum.py.

- [ ] **Step 4: Commit**

```bash
git add backend/app/storage/models/curriculum.py backend/app/storage/models/__init__.py
git commit -m "feat(db): add curriculum and learner-lesson models"
```

---

## Task 2: Update Session Model

**Files:**
- Modify: `backend/app/storage/models/session.py`

- [ ] **Step 1: Add `lesson_id` and `collection_id` to Session**

Add after the `deleted` field in `backend/app/storage/models/session.py`:

```python
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("curriculum_lesson.id", ondelete="SET NULL"), nullable=True
    )
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), nullable=True   # FK to future collection table; not constrained in V1
    )
```

Also add the import at the top of the file:

```python
import sqlalchemy as sa
```

The full updated imports block (replace existing imports):

```python
from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.base import Base, TimestampMixin
```

- [ ] **Step 2: Verify mypy**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just typecheck 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/storage/models/session.py
git commit -m "feat(db): add lesson_id and collection_id to session"
```

---

## Task 3: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/<hash>_add_curriculum_system.py`

- [ ] **Step 1: Generate migration**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just migrate "add curriculum system"
```

- [ ] **Step 2: Review and fix the generated migration**

Open the new file in `backend/alembic/versions/`. Autogenerate is mostly correct but verify:
1. `server_default=sa.text("now()")` is present on all `created_at` and `updated_at` columns
2. Foreign key constraints all have `ondelete=` matching the models
3. The `session` table `ALTER COLUMN` for `lesson_id` and `collection_id` is present

The migration should include (among the auto-generated content):

```python
# New tables (order matters — parent before child):
op.create_table("language_item", ...)
op.create_table("curriculum", ...)
op.create_table("curriculum_unit", ...)
op.create_table("curriculum_lesson", ...)
op.create_table("lesson_item", ...)
op.create_table("learner_lesson", ...)
op.create_table("learner_item_stats", ...)

# Modify existing session table:
op.add_column("session", sa.Column("lesson_id", sa.Uuid(), nullable=True))
op.add_column("session", sa.Column("collection_id", sa.Uuid(), nullable=True))
op.create_foreign_key(
    None, "session", "curriculum_lesson",
    ["lesson_id"], ["id"], ondelete="SET NULL"
)
```

- [ ] **Step 3: Apply migration**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just db-up
```

Expected output ends with: `Running upgrade ... -> <hash>, add curriculum system`

- [ ] **Step 4: Verify tables exist**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just be run python -c "
from app.storage.db import engine
import asyncio
from sqlalchemy import text, inspect
from sqlalchemy.ext.asyncio import AsyncSession

async def check():
    async with engine.connect() as conn:
        result = await conn.execute(text(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\"))
        print([r[0] for r in result])

asyncio.run(check())
"
```

Expected: list includes `curriculum`, `curriculum_lesson`, `curriculum_unit`, `language_item`, `learner_item_stats`, `learner_lesson`, `lesson_item`.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat(db): migration — add curriculum system tables"
```

---

## Task 4: Seed Script

**Files:**
- Create: `backend/scripts/seed_kids_corner_u4.py`
- Create: `backend/scripts/__init__.py` (empty)

- [ ] **Step 1: Create the seed script**

```python
# backend/scripts/seed_kids_corner_u4.py
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

from app.storage.db import AsyncSessionLocal
from app.storage.models.curriculum import (
    Curriculum,
    CurriculumLesson,
    CurriculumUnit,
    LanguageItem,
    LessonItem,
)


async def upsert_item(
    db: AsyncSession, *, type_: str, text: str, anchor: str
) -> uuid.UUID:
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
    async with AsyncSessionLocal() as db:
        # ── Curriculum ───────────────────────────────────────────────────────
        row = await db.execute(
            select(Curriculum).where(Curriculum.name == "Kids Corner Book 1")
        )
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
            "red", "yellow", "blue", "green", "orange",
            "brown", "pink", "purple", "black", "white",
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
```

- [ ] **Step 2: Create empty `__init__.py`**

```bash
touch /Users/peixinliu/Develop/github/_peixin/talking-text/backend/scripts/__init__.py
```

- [ ] **Step 3: Run the seed**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just be run python scripts/seed_kids_corner_u4.py
```

Expected output:
```
Curriculum: <uuid>
Unit: <uuid>
Lesson 1: <uuid>
Lesson 2: <uuid>
Seed complete.
  Lesson 1 id: <uuid>
  Lesson 2 id: <uuid>
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/
git commit -m "chore: seed Kids Corner Book 1 Unit 4 curriculum data"
```

---

## Task 5: Scope Computer

**Files:**
- Create: `backend/app/core/scope/protocol.py`
- Create: `backend/app/core/scope/v1.py`
- Modify: `backend/app/core/scope/__init__.py`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1: Write the protocol**

```python
# backend/app/core/scope/protocol.py
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class PatternItem:
    text: str    # "I like ___ and ___."
    anchor: str  # "i like"  (lowercase fixed substring for detection)


@dataclass
class ScopeResult:
    words: list[str] = field(default_factory=list)
    phrases: list[str] = field(default_factory=list)
    patterns: list[PatternItem] = field(default_factory=list)
    prompt_notes: str | None = None
    focus_instructions: str | None = None

    @property
    def is_empty(self) -> bool:
        return not self.words and not self.phrases and not self.patterns


class ScopeComputer(Protocol):
    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        lesson_id: uuid.UUID | None,
        collection_id: uuid.UUID | None,
    ) -> ScopeResult: ...
```

- [ ] **Step 2: Write the V1 implementation**

```python
# backend/app/core/scope/v1.py
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope.protocol import PatternItem, ScopeResult
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
            raise NotImplementedError("Collection path is not implemented in V1")

        if lesson_id is None:
            return ScopeResult()

        # Load lesson metadata (prompt_notes, focus_instructions).
        lesson_row = await db.execute(
            select(CurriculumLesson).where(CurriculumLesson.id == lesson_id)
        )
        lesson = lesson_row.scalar_one_or_none()
        if lesson is None:
            return ScopeResult()

        # Load all language items for this lesson.
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
                PatternItem(text=i.text, anchor=i.anchor)
                for i in items
                if i.type == "pattern"
            ],
            prompt_notes=lesson.prompt_notes,
            focus_instructions=lesson.focus_instructions,
        )
```

- [ ] **Step 3: Update `__init__.py`**

```python
# backend/app/core/scope/__init__.py
from app.core.scope.protocol import PatternItem, ScopeComputer, ScopeResult
from app.core.scope.v1 import V1ScopeComputer

__all__ = ["PatternItem", "ScopeComputer", "ScopeResult", "V1ScopeComputer"]
```

- [ ] **Step 4: Verify mypy**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just typecheck 2>&1 | grep -E "error|scope"
```

Expected: no errors in scope files.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/scope/
git commit -m "feat(scope): add ScopeComputer protocol and V1 implementation"
```

---

## Task 6: Prompt Assembler

**Files:**
- Create: `backend/app/core/prompt/assembler.py`
- Modify: `backend/app/core/prompt/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_prompt_assembler.py`

- [ ] **Step 1: Write the assembler**

```python
# backend/app/core/prompt/assembler.py
"""Build the LLM system prompt from a ScopeResult.

Pure function — no I/O. The output is a multi-section string that is passed
as the ``system`` message to the LLM. Each section is only included when its
data is present, so the empty-scope case degrades to the plain Tina persona.
"""

from __future__ import annotations

from app.core.scope.protocol import ScopeResult

_TINA_PERSONA = (
    "You are Tina, a warm and patient English teacher chatting with an "
    "elementary-school child in mainland China. Always respond in English. "
    "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). "
    "If the child speaks Chinese, gently re-phrase their idea in English and "
    "invite them to repeat it. Stay encouraging; never correct mistakes "
    "harshly. Each turn, ask exactly one short follow-up question to keep "
    "the conversation going."
)


def build_system_prompt(scope: ScopeResult) -> str:
    """Return the full system prompt string for a session."""
    sections: list[str] = [_TINA_PERSONA]

    if scope.words or scope.phrases:
        vocab_lines: list[str] = []
        if scope.words:
            vocab_lines.append(f"Words: {', '.join(scope.words)}")
        if scope.phrases:
            vocab_lines.append(f"Phrases: {', '.join(scope.phrases)}")
        sections.append(
            "The child has learned these vocabulary items. Use them naturally in "
            "conversation. Do not introduce vocabulary outside this list "
            "(one or two new words per session is fine):\n"
            + "\n".join(vocab_lines)
        )

    if scope.patterns:
        pattern_lines = "\n".join(
            f'  • "{p.text}"' for p in scope.patterns
        )
        sections.append(
            "Practice these sentence patterns today. "
            "Guide the child to use them:\n" + pattern_lines
        )

    if scope.prompt_notes:
        sections.append(
            "Grammar notes (apply gently, never correct harshly):\n"
            + scope.prompt_notes
        )

    if scope.focus_instructions:
        sections.append("Today's practice focus:\n" + scope.focus_instructions)

    return "\n\n".join(sections)
```

- [ ] **Step 2: Update `__init__.py`**

```python
# backend/app/core/prompt/__init__.py
from app.core.prompt.assembler import build_system_prompt

__all__ = ["build_system_prompt"]
```

- [ ] **Step 3: Create tests directory**

```bash
mkdir -p /Users/peixinliu/Develop/github/_peixin/talking-text/backend/tests
touch /Users/peixinliu/Develop/github/_peixin/talking-text/backend/tests/__init__.py
```

- [ ] **Step 4: Write unit tests**

```python
# backend/tests/test_prompt_assembler.py
from app.core.prompt.assembler import build_system_prompt, _TINA_PERSONA
from app.core.scope.protocol import PatternItem, ScopeResult


def test_empty_scope_returns_tina_persona_only():
    result = build_system_prompt(ScopeResult())
    assert result == _TINA_PERSONA


def test_words_appear_in_vocab_section():
    scope = ScopeResult(words=["red", "blue"], phrases=[])
    result = build_system_prompt(scope)
    assert "Words: red, blue" in result
    assert "The child has learned" in result


def test_phrases_appear_in_vocab_section():
    scope = ScopeResult(phrases=["draw and color"])
    result = build_system_prompt(scope)
    assert "Phrases: draw and color" in result


def test_patterns_appear_in_patterns_section():
    scope = ScopeResult(
        patterns=[PatternItem(text="I like ___ and ___.", anchor="i like")]
    )
    result = build_system_prompt(scope)
    assert '"I like ___ and ___."' in result
    assert "Practice these sentence patterns" in result


def test_prompt_notes_appear():
    scope = ScopeResult(prompt_notes="Use 'has' for he/she.")
    result = build_system_prompt(scope)
    assert "Grammar notes" in result
    assert "Use 'has' for he/she." in result


def test_focus_instructions_appear():
    scope = ScopeResult(focus_instructions="Describe monster outfits.")
    result = build_system_prompt(scope)
    assert "Today's practice focus" in result
    assert "Describe monster outfits." in result


def test_sections_are_separated_by_double_newline():
    scope = ScopeResult(words=["red"], prompt_notes="Use has.")
    result = build_system_prompt(scope)
    assert "\n\n" in result


def test_persona_always_first():
    scope = ScopeResult(words=["red"], patterns=[PatternItem("I like ___.", "i like")])
    result = build_system_prompt(scope)
    assert result.startswith(_TINA_PERSONA)
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/backend && poetry run pytest tests/test_prompt_assembler.py -v
```

Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/prompt/ backend/tests/
git commit -m "feat(prompt): add PromptAssembler with unit tests"
```

---

## Task 7: Wire Scope Computer into Orchestrator

**Files:**
- Modify: `backend/app/core/dialog/orchestrator.py`
- Modify: `backend/app/adapters/factory.py`

- [ ] **Step 1: Update orchestrator imports and constructor**

In `backend/app/core/dialog/orchestrator.py`:

Replace the import block (keep existing imports, add these):
```python
from app.core.prompt import build_system_prompt
from app.core.scope import ScopeComputer, ScopeResult
from app.storage.models.session import Session
```

Replace the `_SYSTEM_PROMPT` constant and `DialogOrchestrator.__init__`:
```python
# Remove the _SYSTEM_PROMPT constant entirely.

class DialogOrchestrator:
    def __init__(
        self,
        *,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
        scope: ScopeComputer,
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._scope = scope
```

- [ ] **Step 2: Add `_resolve_system_prompt` helper**

Add this private method to `DialogOrchestrator` (after `__init__`):

```python
    async def _resolve_system_prompt(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> str:
        """Fetch session lesson binding and build the system prompt."""
        session_row = await db.execute(
            select(Session).where(Session.id == session_id)
        )
        session = session_row.scalar_one_or_none()
        lesson_id = session.lesson_id if session else None
        collection_id = session.collection_id if session else None
        scope = await self._scope.get_scope(db, learner_id, lesson_id, collection_id)
        return build_system_prompt(scope)
```

Also add `from sqlalchemy import select` to imports if not already present (it already is via `func`).

- [ ] **Step 3: Replace `_SYSTEM_PROMPT` usage in `single_turn`**

In `single_turn`, find this line:
```python
        messages: list[LLMMessage] = [LLMMessage(role="system", content=_SYSTEM_PROMPT)]
```

Replace with:
```python
        system_prompt = await self._resolve_system_prompt(db, learner_id, session_id)
        messages: list[LLMMessage] = [LLMMessage(role="system", content=system_prompt)]
```

- [ ] **Step 4: Replace `_SYSTEM_PROMPT` usage in `_stream_turn_impl`**

Find the same pattern in `_stream_turn_impl` and apply the same replacement:
```python
        system_prompt = await self._resolve_system_prompt(db, learner_id, session_id)
        messages: list[LLMMessage] = [LLMMessage(role="system", content=system_prompt)]
```

- [ ] **Step 5: Update factory to create ScopeComputer**

In `backend/app/adapters/factory.py`, add import and update orchestrator creation:

```python
from app.core.scope import V1ScopeComputer
```

Replace the orchestrator singleton line:
```python
orchestrator: DialogOrchestrator = DialogOrchestrator(
    stt=stt, llm=llm, tts=tts, scope=V1ScopeComputer()
)
```

- [ ] **Step 6: Verify mypy and ruff**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just check
```

Expected: no errors.

- [ ] **Step 7: Smoke test — start the API and send a turn**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just api &
sleep 3
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `{"status": "ok"}`

Kill the background server after: `pkill -f "uvicorn"`

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/dialog/orchestrator.py backend/app/adapters/factory.py
git commit -m "feat(scope): wire ScopeComputer and PromptAssembler into orchestrator"
```

---

## Task 8: Backend Curriculum API

**Files:**
- Create: `backend/app/api/curriculum.py`
- Modify: `backend/app/api/__init__.py`

- [ ] **Step 1: Write the curriculum router**

```python
# backend/app/api/curriculum.py
"""Curriculum browsing and learner-lesson management endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.curriculum import (
    Curriculum,
    CurriculumLesson,
    CurriculumUnit,
    LearnerLesson,
)
from app.storage.models.learner import Learner

router = APIRouter(tags=["curriculum"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class CurriculumSummary(BaseModel):
    id: uuid.UUID
    name: str
    publisher: str | None

    model_config = {"from_attributes": True}


class LessonSummary(BaseModel):
    id: uuid.UUID
    sequence: int
    title: str | None

    model_config = {"from_attributes": True}


class UnitWithLessons(BaseModel):
    id: uuid.UUID
    unit_number: str
    title: str
    sequence: int
    lessons: list[LessonSummary]


class CurriculumLessonsOut(BaseModel):
    curriculum: CurriculumSummary
    units: list[UnitWithLessons]


class LessonInfoOut(BaseModel):
    lesson_id: uuid.UUID
    lesson_title: str | None
    lesson_sequence: int
    unit_number: str
    unit_title: str
    curriculum_name: str
    added_at: datetime


class AddLessonBody(BaseModel):
    lesson_id: uuid.UUID


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _require_learner(
    learner_id: uuid.UUID, account: Account, db: AsyncSession
) -> Learner:
    row = await db.execute(
        select(Learner).where(
            Learner.id == learner_id, Learner.account_id == account.id
        )
    )
    learner = row.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    return learner


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/curricula", response_model=list[CurriculumSummary])
async def list_curricula(
    db: Annotated[AsyncSession, Depends(get_db)],
    _account: Annotated[Account, Depends(get_current_account)],
) -> list[Curriculum]:
    rows = await db.execute(
        select(Curriculum).where(Curriculum.is_public.is_(True))
    )
    return list(rows.scalars().all())


@router.get("/curricula/{curriculum_id}/lessons", response_model=CurriculumLessonsOut)
async def get_curriculum_lessons(
    curriculum_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _account: Annotated[Account, Depends(get_current_account)],
) -> CurriculumLessonsOut:
    curr_row = await db.execute(
        select(Curriculum).where(Curriculum.id == curriculum_id)
    )
    curriculum = curr_row.scalar_one_or_none()
    if not curriculum:
        raise HTTPException(status_code=404, detail="Curriculum not found")

    units_row = await db.execute(
        select(CurriculumUnit)
        .where(CurriculumUnit.curriculum_id == curriculum_id)
        .order_by(CurriculumUnit.sequence)
    )
    units = list(units_row.scalars().all())

    result_units: list[UnitWithLessons] = []
    for unit in units:
        lessons_row = await db.execute(
            select(CurriculumLesson)
            .where(CurriculumLesson.unit_id == unit.id)
            .order_by(CurriculumLesson.sequence)
        )
        lessons = list(lessons_row.scalars().all())
        result_units.append(
            UnitWithLessons(
                id=unit.id,
                unit_number=unit.unit_number,
                title=unit.title,
                sequence=unit.sequence,
                lessons=[
                    LessonSummary(id=l.id, sequence=l.sequence, title=l.title)
                    for l in lessons
                ],
            )
        )

    return CurriculumLessonsOut(
        curriculum=CurriculumSummary(
            id=curriculum.id, name=curriculum.name, publisher=curriculum.publisher
        ),
        units=result_units,
    )


@router.post(
    "/learners/{learner_id}/lessons",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def add_learner_lesson(
    learner_id: uuid.UUID,
    body: AddLessonBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _require_learner(learner_id, account, db)
    # Verify lesson exists.
    lesson_row = await db.execute(
        select(CurriculumLesson).where(CurriculumLesson.id == body.lesson_id)
    )
    if not lesson_row.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Lesson not found")
    # Upsert (idempotent).
    existing = await db.execute(
        select(LearnerLesson).where(
            LearnerLesson.learner_id == learner_id,
            LearnerLesson.lesson_id == body.lesson_id,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(LearnerLesson(learner_id=learner_id, lesson_id=body.lesson_id))
        await db.commit()


@router.delete(
    "/learners/{learner_id}/lessons/{lesson_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def remove_learner_lesson(
    learner_id: uuid.UUID,
    lesson_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _require_learner(learner_id, account, db)
    row = await db.execute(
        select(LearnerLesson).where(
            LearnerLesson.learner_id == learner_id,
            LearnerLesson.lesson_id == lesson_id,
        )
    )
    entry = row.scalar_one_or_none()
    if entry:
        await db.delete(entry)
        await db.commit()


@router.get("/learners/{learner_id}/lessons", response_model=list[LessonInfoOut])
async def list_learner_lessons(
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[LessonInfoOut]:
    await _require_learner(learner_id, account, db)

    rows = await db.execute(
        select(
            LearnerLesson.lesson_id,
            LearnerLesson.created_at,
            CurriculumLesson.title.label("lesson_title"),
            CurriculumLesson.sequence.label("lesson_sequence"),
            CurriculumUnit.unit_number,
            CurriculumUnit.title.label("unit_title"),
            Curriculum.name.label("curriculum_name"),
        )
        .join(CurriculumLesson, CurriculumLesson.id == LearnerLesson.lesson_id)
        .join(CurriculumUnit, CurriculumUnit.id == CurriculumLesson.unit_id)
        .join(Curriculum, Curriculum.id == CurriculumUnit.curriculum_id)
        .where(LearnerLesson.learner_id == learner_id)
        .order_by(LearnerLesson.created_at.desc())
    )

    return [
        LessonInfoOut(
            lesson_id=r.lesson_id,
            lesson_title=r.lesson_title,
            lesson_sequence=r.lesson_sequence,
            unit_number=r.unit_number,
            unit_title=r.unit_title,
            curriculum_name=r.curriculum_name,
            added_at=r.created_at,
        )
        for r in rows
    ]
```

- [ ] **Step 2: Register the router in `app/api/__init__.py`**

```python
from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.curriculum import router as curriculum_router
from app.api.health import router as health_router
from app.api.learner import router as learner_router
from app.api.session import router as session_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(learner_router)
api_router.include_router(session_router)
api_router.include_router(curriculum_router)
```

- [ ] **Step 3: Verify mypy + ruff**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just check
```

- [ ] **Step 4: Smoke test the curriculum endpoints**

Start the API: `just api &` then wait 3 seconds.

```bash
# Login first to get a session cookie
curl -s -c /tmp/cookies.txt -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | python3 -m json.tool

# List public curricula
curl -s -b /tmp/cookies.txt http://localhost:8000/curricula | python3 -m json.tool

# Get lessons for the curriculum (replace UUID with actual id from above)
curl -s -b /tmp/cookies.txt http://localhost:8000/curricula/<CURRICULUM_UUID>/lessons | python3 -m json.tool
```

Expected: curricula returns Kids Corner Book 1; lessons returns unit with 2 lessons.

Kill API: `pkill -f "uvicorn"`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/curriculum.py backend/app/api/__init__.py
git commit -m "feat(api): add curriculum browsing and learner-lesson endpoints"
```

---

## Task 9: Session API Lesson Support

**Files:**
- Modify: `backend/app/api/session.py`

- [ ] **Step 1: Update `CreateSessionBody` to include `lesson_id`**

Find `CreateSessionBody`:
```python
class CreateSessionBody(BaseModel):
    learner_id: uuid.UUID
```

Replace with:
```python
class CreateSessionBody(BaseModel):
    learner_id: uuid.UUID
    lesson_id: uuid.UUID | None = None
```

- [ ] **Step 2: Update `UpdateSessionBody` to include `lesson_id`**

Find `UpdateSessionBody`:
```python
class UpdateSessionBody(BaseModel):
    title: str
```

Replace with:
```python
class UpdateSessionBody(BaseModel):
    title: str | None = None
    lesson_id: uuid.UUID | None = None
```

- [ ] **Step 3: Update `SessionOut` to expose `lesson_id`**

Find `SessionOut`:
```python
class SessionOut(BaseModel):
    id: uuid.UUID
    learner_id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

Replace with:
```python
class SessionOut(BaseModel):
    id: uuid.UUID
    learner_id: uuid.UUID
    lesson_id: uuid.UUID | None
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Update `create_session` handler to write `lesson_id`**

Find the `create_session` route. Replace the Session creation:
```python
    session = Session(learner_id=body.learner_id)
```

With:
```python
    session = Session(learner_id=body.learner_id, lesson_id=body.lesson_id)
```

- [ ] **Step 5: Update `update_session` handler to support `lesson_id` patch**

Find the `update_session` route. Replace its body:
```python
    session = await _require_session(session_id, account, db)
    session.title = body.title.strip() or None
    await db.commit()
    await db.refresh(session)
    return session
```

With:
```python
    session = await _require_session(session_id, account, db)
    if body.title is not None:
        session.title = body.title.strip() or None
    if body.lesson_id is not None:
        session.lesson_id = body.lesson_id
    await db.commit()
    await db.refresh(session)
    return session
```

- [ ] **Step 6: Verify mypy + ruff**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just check
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/session.py
git commit -m "feat(api): add lesson_id to session create and patch"
```

---

## Task 10: Frontend — Backend Types and API Client

**Files:**
- Modify: `frontend/lib/backend.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add new types to `backend.ts`**

Add after the existing `SessionOut` type:

```typescript
export type SessionOut = {
  id: string;
  learner_id: string;
  lesson_id: string | null;   // added
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type LessonInfoOut = {
  lesson_id: string;
  lesson_title: string | null;
  lesson_sequence: number;
  unit_number: string;
  unit_title: string;
  curriculum_name: string;
  added_at: string;
};

export type CurriculumSummary = {
  id: string;
  name: string;
  publisher: string | null;
};

export type CurriculumLessonsOut = {
  curriculum: CurriculumSummary;
  units: {
    id: string;
    unit_number: string;
    title: string;
    sequence: number;
    lessons: { id: string; sequence: number; title: string | null }[];
  }[];
};
```

Note: the `SessionOut` type already exists in `backend.ts` — replace it with the version above that adds `lesson_id`.

- [ ] **Step 2: Add curriculum methods to the `backend` object**

Inside the `backend` export object in `backend.ts`, add after `sessions`:

```typescript
  curricula: {
    list: (headers?: HeadersInit) =>
      request<CurriculumSummary[]>("/curricula", { headers }),
    getLessons: (curriculumId: string, headers?: HeadersInit) =>
      request<CurriculumLessonsOut>(`/curricula/${curriculumId}/lessons`, { headers }),
  },
  learnerLessons: {
    list: (learnerId: string, headers?: HeadersInit) =>
      request<LessonInfoOut[]>(`/learners/${learnerId}/lessons`, { headers }),
    add: (learnerId: string, lessonId: string, headers?: HeadersInit) =>
      request<void>(`/learners/${learnerId}/lessons`, {
        method: "POST",
        body: { lesson_id: lessonId },
        headers,
      }),
    remove: (learnerId: string, lessonId: string, headers?: HeadersInit) =>
      request<void>(`/learners/${learnerId}/lessons/${lessonId}`, {
        method: "DELETE",
        headers,
      }),
  },
```

Also update `sessions.create` to accept an optional `lessonId`:

```typescript
    create: (learnerId: string, lessonId?: string, headers?: HeadersInit) =>
      request<SessionOut>("/sessions", {
        method: "POST",
        body: { learner_id: learnerId, lesson_id: lessonId ?? null },
        headers,
      }),
    setLesson: (sessionId: string, lessonId: string, headers?: HeadersInit) =>
      request<SessionOut>(`/sessions/${sessionId}`, {
        method: "PATCH",
        body: { lesson_id: lessonId },
        headers,
      }),
```

- [ ] **Step 3: Expose new methods in `api.ts`**

In `frontend/lib/api.ts`, inside `createApi()`, add after `sessions`:

```typescript
    curricula: {
      list: () => c((h) => backend.curricula.list(h)),
      getLessons: (curriculumId: string) =>
        c((h) => backend.curricula.getLessons(curriculumId, h)),
    },
    learnerLessons: {
      list: (learnerId: string) => c((h) => backend.learnerLessons.list(learnerId, h)),
      add: (learnerId: string, lessonId: string) =>
        c((h) => backend.learnerLessons.add(learnerId, lessonId, h)),
      remove: (learnerId: string, lessonId: string) =>
        c((h) => backend.learnerLessons.remove(learnerId, lessonId, h)),
    },
```

Also update the sessions entry:
```typescript
    sessions: {
      list: (learnerId: string) => c((h) => backend.sessions.list(learnerId, h)),
      create: (learnerId: string, lessonId?: string) =>
        c((h) => backend.sessions.create(learnerId, lessonId, h)),
      setLesson: (sessionId: string, lessonId: string) =>
        c((h) => backend.sessions.setLesson(sessionId, lessonId, h)),
      rename: (id: string, title: string) => c((h) => backend.sessions.rename(id, title, h)),
      delete: (id: string) => c((h) => backend.sessions.delete(id, h)),
      turns: (id: string) => c((h) => backend.sessions.turns(id, h)),
      getTurnAudio: (sessionId: string, turnId: string, dir: "in" | "out") =>
        c((h) => backend.sessions.getTurnAudio(sessionId, turnId, dir, h)),
    },
```

- [ ] **Step 4: Type-check frontend**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/backend.ts frontend/lib/api.ts
git commit -m "feat(frontend): add curriculum and learner-lesson types and API client methods"
```

---

## Task 11: Install shadcn Components

**Files:**
- Modify: `frontend/components/ui/` (managed by shadcn)

- [ ] **Step 1: Install components**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend && \
  pnpm dlx shadcn@latest add dialog badge card collapsible checkbox separator
```

Answer "yes" to any prompts. This writes files into `components/ui/`.

- [ ] **Step 2: Verify files exist**

```bash
ls /Users/peixinliu/Develop/github/_peixin/talking-text/frontend/components/ui/
```

Expected: `badge.tsx`, `card.tsx`, `checkbox.tsx`, `collapsible.tsx`, `dialog.tsx`, `separator.tsx` present alongside existing `button.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text
git add frontend/components/ui/ frontend/components.json 2>/dev/null; true
git commit -m "chore(ui): install shadcn dialog, badge, card, collapsible, checkbox, separator"
```

---

## Task 12: LessonPickerClient Component

**Files:**
- Create: `frontend/components/LessonPickerClient.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/LessonPickerClient.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { CurriculumLessonsOut, LessonInfoOut } from "@/lib/backend";

// ── Enroll mode ──────────────────────────────────────────────────────────────

interface EnrollModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  curricula: { id: string; name: string; publisher: string | null }[];
  getLessons: (curriculumId: string) => Promise<CurriculumLessonsOut>;
  onEnroll: (lessonIds: string[]) => Promise<void>;
}

export function LessonEnrollDialog({
  open,
  onOpenChange,
  curricula,
  getLessons,
  onEnroll,
}: EnrollModeProps) {
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [lessonsData, setLessonsData] = useState<CurriculumLessonsOut | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (selectedCurriculumId) {
      getLessons(selectedCurriculumId).then(setLessonsData);
    }
  }, [selectedCurriculumId, getLessons]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSave = () => {
    if (selectedIds.size === 0) return;
    startTransition(async () => {
      await onEnroll([...selectedIds]);
      setSelectedIds(new Set());
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Lessons</DialogTitle>
        </DialogHeader>

        {!selectedCurriculumId ? (
          <div className="space-y-2">
            {curricula.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCurriculumId(c.id)}
                className="hover:bg-accent w-full rounded-md border p-3 text-left transition"
              >
                <div className="font-medium">{c.name}</div>
                {c.publisher && (
                  <div className="text-muted-foreground text-sm">{c.publisher}</div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => { setSelectedCurriculumId(null); setLessonsData(null); }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              ← Back
            </button>
            {lessonsData?.units.map((unit) => (
              <Collapsible key={unit.id} defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between py-1 font-medium">
                  <span>{unit.unit_number} — {unit.title}</span>
                  <span className="text-muted-foreground text-xs">▾</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 space-y-1 pt-1">
                  {unit.lessons.map((lesson) => (
                    <label
                      key={lesson.id}
                      className="flex cursor-pointer items-center gap-3 rounded py-1"
                    >
                      <Checkbox
                        checked={selectedIds.has(lesson.id)}
                        onCheckedChange={() => toggle(lesson.id)}
                      />
                      <span className="text-sm">
                        {lesson.title ?? `Lesson ${lesson.sequence}`}
                      </span>
                    </label>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}

        <Separator />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={selectedIds.size === 0 || isPending}
          >
            {isPending ? "Saving…" : `Add ${selectedIds.size} lesson${selectedIds.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Switch mode ───────────────────────────────────────────────────────────────

interface SwitchModeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrolledLessons: LessonInfoOut[];
  onSelect: (lessonId: string) => void;
}

export function LessonSwitchDialog({
  open,
  onOpenChange,
  enrolledLessons,
  onSelect,
}: SwitchModeProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a Lesson</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {enrolledLessons.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No lessons added yet. Go to the learner home page to add lessons.
            </p>
          )}
          {enrolledLessons.map((l) => (
            <button
              key={l.lesson_id}
              onClick={() => { onSelect(l.lesson_id); onOpenChange(false); }}
              className="hover:bg-accent w-full rounded-md border p-3 text-left transition"
            >
              <div className="text-sm font-medium">
                {l.curriculum_name} · {l.unit_number}
              </div>
              <div className="text-muted-foreground text-xs">
                {l.lesson_title ?? `Lesson ${l.lesson_sequence}`}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/LessonPickerClient.tsx
git commit -m "feat(ui): add LessonEnrollDialog and LessonSwitchDialog components"
```

---

## Task 13: Learner Home Page

**Files:**
- Create: `frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx`
- Create: `frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx`
- Create: `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts`

- [ ] **Step 1: Write Server Actions**

```typescript
// frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createApi } from "@/lib/api";
import type { CurriculumLessonsOut } from "@/lib/backend";

export async function addLesson(learnerId: string, lessonId: string): Promise<void> {
  const api = await createApi();
  await api.learnerLessons.add(learnerId, lessonId);
  revalidatePath(`/learner/${learnerId}`);
}

export async function removeLesson(learnerId: string, lessonId: string): Promise<void> {
  const api = await createApi();
  await api.learnerLessons.remove(learnerId, lessonId);
  revalidatePath(`/learner/${learnerId}`);
}

export async function fetchCurriculumLessons(
  curriculumId: string
): Promise<CurriculumLessonsOut> {
  const api = await createApi();
  return api.curricula.getLessons(curriculumId);
}
```

- [ ] **Step 2: Write Client Component**

```tsx
// frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LessonEnrollDialog } from "@/components/LessonPickerClient";
import type { CurriculumLessonsOut, CurriculumSummary, LessonInfoOut } from "@/lib/backend";
import { addLesson, removeLesson, fetchCurriculumLessons } from "./actions";

interface Props {
  learnerId: string;
  learnerName: string;
  enrolledLessons: LessonInfoOut[];
  curricula: CurriculumSummary[];
}

export function LearnerHomeClient({
  learnerId,
  learnerName,
  enrolledLessons,
  curricula,
}: Props) {
  const router = useRouter();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const latestLesson = enrolledLessons[0];

  const handleEnroll = async (lessonIds: string[]) => {
    for (const id of lessonIds) {
      await addLesson(learnerId, id);
    }
  };

  const handleRemove = (lessonId: string) => {
    startTransition(async () => {
      await removeLesson(learnerId, lessonId);
    });
  };

  const handleStartPractice = () => {
    const params = latestLesson
      ? `?lessonId=${latestLesson.lesson_id}`
      : "";
    router.push(`/chat${params}`);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{learnerName}</h1>
        <Button onClick={handleStartPractice}>Start Practice →</Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Lessons</h2>
          <Button variant="outline" size="sm" onClick={() => setEnrollOpen(true)}>
            + Add
          </Button>
        </div>

        {enrolledLessons.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No lessons added yet. Click &quot;+ Add&quot; to browse the curriculum.
          </p>
        )}

        {enrolledLessons.map((l) => (
          <Card key={l.lesson_id} className="flex items-center justify-between p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                {l.curriculum_name}
                <Badge variant="secondary" className="text-xs">
                  {l.unit_number}
                </Badge>
              </div>
              <div className="text-muted-foreground text-xs">
                {l.lesson_title ?? `Lesson ${l.lesson_sequence}`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleRemove(l.lesson_id)}
              className="text-muted-foreground hover:text-destructive"
            >
              Remove
            </Button>
          </Card>
        ))}
      </div>

      <LessonEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        curricula={curricula}
        getLessons={fetchCurriculumLessons}
        onEnroll={handleEnroll}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write Server Component page**

```tsx
// frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx
import { createApi } from "@/lib/api";
import { LearnerHomeClient } from "./LearnerHomeClient";

interface Props {
  params: Promise<{ learnerId: string; locale: string }>;
}

export default async function LearnerHomePage({ params }: Props) {
  const { learnerId } = await params;
  const api = await createApi();

  const [learners, enrolledLessons, curricula] = await Promise.all([
    api.learners.list(),
    api.learnerLessons.list(learnerId),
    api.curricula.list(),
  ]);

  const learner = learners.find((l) => l.id === learnerId);
  if (!learner) return <div>Learner not found.</div>;

  return (
    <LearnerHomeClient
      learnerId={learnerId}
      learnerName={learner.name}
      enrolledLessons={enrolledLessons}
      curricula={curricula}
    />
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend && pnpm tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/[locale]/(app)/learner/"
git commit -m "feat(frontend): add learner home page with lesson management"
```

---

## Task 14: Chat Page — Lesson Banner and Session Creation

**Files:**
- Create: `frontend/components/LessonBannerClient.tsx`
- Modify: `frontend/app/[locale]/(app)/chat/page.tsx`
- Modify: `frontend/app/[locale]/(app)/chat/[sessionId]/actions.ts`
- Modify: `frontend/app/[locale]/(app)/chat/[sessionId]/ChatClient.tsx`

- [ ] **Step 1: Write LessonBannerClient**

```tsx
// frontend/components/LessonBannerClient.tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LessonSwitchDialog } from "@/components/LessonPickerClient";
import type { LessonInfoOut } from "@/lib/backend";

interface Props {
  sessionId: string;
  currentLesson: LessonInfoOut | null;
  enrolledLessons: LessonInfoOut[];
  onLessonChange: (lessonId: string) => Promise<void>;
}

export function LessonBannerClient({
  currentLesson,
  enrolledLessons,
  onLessonChange,
}: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);

  const handleSelect = async (lessonId: string) => {
    await onLessonChange(lessonId);
  };

  if (!currentLesson) {
    return (
      <>
        <div className="border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950">
          <span className="text-amber-700 dark:text-amber-300">
            📚 No lesson selected —{" "}
          </span>
          <button
            onClick={() => setSwitchOpen(true)}
            className="font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
          >
            select today&apos;s lesson
          </button>
          <span className="text-muted-foreground ml-2 text-xs">
            (or chat freely without a lesson)
          </span>
        </div>
        <LessonSwitchDialog
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          enrolledLessons={enrolledLessons}
          onSelect={handleSelect}
        />
      </>
    );
  }

  return (
    <>
      <div className="border-b bg-muted/40 flex items-center gap-3 px-4 py-2">
        <span className="text-sm">📚</span>
        <div className="flex flex-1 items-center gap-2 text-sm">
          <span className="font-medium">{currentLesson.curriculum_name}</span>
          <Badge variant="secondary" className="text-xs">
            {currentLesson.unit_number}
          </Badge>
          <span className="text-muted-foreground">
            · {currentLesson.lesson_title ?? `Lesson ${currentLesson.lesson_sequence}`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs"
          onClick={() => setSwitchOpen(true)}
        >
          Switch
        </Button>
      </div>
      <LessonSwitchDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        enrolledLessons={enrolledLessons}
        onSelect={handleSelect}
      />
    </>
  );
}
```

- [ ] **Step 2: Update `createSession` action to accept `lessonId`**

In `frontend/app/[locale]/(app)/chat/[sessionId]/actions.ts`, update `createSession`:

```typescript
export async function createSession(learnerId: string, lessonId?: string): Promise<SessionOut> {
  const api = await createApi();
  return api.sessions.create(learnerId, lessonId);
}
```

Also add a `setSessionLesson` action in the same file:

```typescript
export async function setSessionLesson(
  sessionId: string,
  lessonId: string
): Promise<SessionOut> {
  const api = await createApi();
  return api.sessions.setLesson(sessionId, lessonId);
}
```

- [ ] **Step 3: Update `chat/page.tsx` to pass `lessonId` when creating a session**

Replace the content of `frontend/app/[locale]/(app)/chat/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { createApi } from "@/lib/api";

interface Props {
  searchParams: Promise<{ lessonId?: string }>;
}

export default async function ChatPage({ searchParams }: Props) {
  const t = await getTranslations("Chat");
  const api = await createApi();
  const { lessonId } = await searchParams;

  const learners = await api.learners.list();

  if (learners.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-20 text-center">
        <h2 className="mb-4 text-xl font-medium">{t("no_learners_title")}</h2>
        <p className="text-muted-foreground mb-8">{t("no_learners_desc")}</p>
        <Link
          href="/parent/learners"
          className="bg-primary text-primary-foreground rounded-md px-6 py-2 transition hover:opacity-90"
        >
          {t("go_add_child")}
        </Link>
      </div>
    );
  }

  const account = await api.auth.me();
  const activeLearnerId = account.last_active_learner_id;
  const activeLearner = learners.find((l) => l.id === activeLearnerId) ?? learners[0];

  // Resolve lesson: use URL param first, fall back to learner's most recent lesson.
  let resolvedLessonId = lessonId;
  if (!resolvedLessonId) {
    const enrolled = await api.learnerLessons.list(activeLearner.id);
    resolvedLessonId = enrolled[0]?.lesson_id;
  }

  // Create a new session (or reuse the most recent one).
  let sessions = await api.sessions.list(activeLearner.id);
  if (sessions.length === 0) {
    const created = await api.sessions.create(activeLearner.id, resolvedLessonId);
    sessions = [created];
  }

  const locale = await getLocale();
  redirect(`/${locale}/chat/${sessions[0].id}`);
}
```

- [ ] **Step 4: Add lesson banner to `ChatClient.tsx`**

In `frontend/app/[locale]/(app)/chat/[sessionId]/ChatClient.tsx`, find where the chat UI is rendered and add the banner above the message list. 

First, add these imports at the top of the file (after existing imports):
```typescript
import { LessonBannerClient } from "@/components/LessonBannerClient";
import type { LessonInfoOut, SessionOut } from "@/lib/backend";
import { setSessionLesson } from "./actions";
```

Add `enrolledLessons` and `sessionLessonId` to the component props:
```typescript
interface ChatClientProps {
  // ... existing props ...
  enrolledLessons: LessonInfoOut[];
  currentLesson: LessonInfoOut | null;
  sessionId: string;
}
```

Inside the component, add state for the current lesson and a handler:
```typescript
  const [activeLesson, setActiveLesson] = useState<LessonInfoOut | null>(currentLesson);

  const handleLessonChange = async (lessonId: string) => {
    await setSessionLesson(sessionId, lessonId);
    const found = enrolledLessons.find((l) => l.lesson_id === lessonId) ?? null;
    setActiveLesson(found);
  };
```

Add the banner just before the message list in the JSX:
```tsx
      <LessonBannerClient
        sessionId={sessionId}
        currentLesson={activeLesson}
        enrolledLessons={enrolledLessons}
        onLessonChange={handleLessonChange}
      />
```

- [ ] **Step 5: Pass lesson data from page to ChatClient**

In `frontend/app/[locale]/(app)/chat/[sessionId]/page.tsx`, load lesson data and pass it as props:

```tsx
// Add to the data fetching in the Server Component:
const [session, enrolledLessons] = await Promise.all([
  // ... existing session fetch ...
  api.learnerLessons.list(session.learner_id),
]);

const currentLesson = session.lesson_id
  ? enrolledLessons.find((l) => l.lesson_id === session.lesson_id) ?? null
  : null;

// Pass to ChatClient:
<ChatClient
  // ... existing props ...
  enrolledLessons={enrolledLessons}
  currentLesson={currentLesson}
  sessionId={session.id}
/>
```

Note: read the existing `page.tsx` carefully before editing to integrate cleanly with its data fetching pattern.

- [ ] **Step 6: Type-check and lint**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend && pnpm tsc --noEmit && pnpm lint
```

Fix any type errors before committing.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/LessonBannerClient.tsx \
  "frontend/app/[locale]/(app)/chat/" \
  "frontend/app/[locale]/(app)/learner/"
git commit -m "feat(frontend): add lesson banner to chat and update session creation"
```

---

## Task 15: End-to-End Verification

- [ ] **Step 1: Start both services**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just dev
```

- [ ] **Step 2: Verify the full flow**

1. Open `http://localhost:3000`
2. Log in
3. Navigate to `/learner/<your-learner-id>` (find the id from the parent page)
4. Click "+ Add" → select "Kids Corner Book 1" → expand "Starter Unit 4" → check "Lesson 2" → click "Add 1 lesson"
5. Verify the lesson appears in the enrolled list
6. Click "Start Practice →"
7. Verify the chat banner shows "Kids Corner Book 1 · Starter Unit 4 · Lesson 2"
8. Send a text message: "Hello Tina!"
9. Verify Tina's response uses clothing/color vocabulary from the lesson scope
10. Click "Switch" in the banner → select Lesson 1 → banner updates to Lesson 1
11. Send another message and verify Tina shifts to color vocabulary

- [ ] **Step 3: Final check**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text && just check
```

Expected: no lint/type errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: curriculum end-to-end — lesson scope wired into chat pipeline"
```
