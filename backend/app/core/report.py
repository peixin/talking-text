"""Parent-facing weekly report — "new words your child produced this week."

Computed at read time from ``turn.text_user`` (CLAUDE.md rule #3: word data is
derived from turn text, never materialized). One artifact, no charts — see
docs/phase2-mastery-stretch.md §4.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope.siblings import next_unit_word_items
from app.core.text import tokenize_words
from app.storage.models.content import (
    ItemGroupLearner,
    ItemGroupMember,
    LanguageItem,
    get_descendant_group_ids,
)
from app.storage.models.session import Session
from app.storage.models.turn import Turn

_WEEK = timedelta(days=7)

#: Tag values, in priority order. ``stretch`` is checked before ``curriculum``
#: because next-unit words are usually also inside the learner's assigned tree.
TAG_STRETCH = "stretch"
TAG_CURRICULUM = "curriculum"
TAG_WILD = "wild"


@dataclass(frozen=True)
class NewWord:
    text: str
    first_said_at: datetime
    count: int
    tag: str  # stretch | curriculum | wild


@dataclass(frozen=True)
class WeeklyReport:
    week_start: datetime
    week_end: datetime
    new_words: list[NewWord]


def tag_word(word: str, stretch_words: set[str], curriculum_words: set[str]) -> str:
    """Pure tagging — ``word`` and both sets are lowercase."""
    if word in stretch_words:
        return TAG_STRETCH
    if word in curriculum_words:
        return TAG_CURRICULUM
    return TAG_WILD


async def weekly_new_words(
    db: AsyncSession,
    learner_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> WeeklyReport:
    now = now if now is not None else datetime.now(UTC)
    week_start = now - _WEEK

    # One chronological pass over the learner's turns: words said before the
    # window are "known"; window words not in that set are this week's news.
    rows = await db.execute(
        select(Turn.text_user, Turn.created_at, Turn.session_id)
        .where(Turn.learner_id == learner_id)
        .order_by(Turn.created_at.asc())
    )
    prior_words: set[str] = set()
    first_said: dict[str, datetime] = {}
    counts: dict[str, int] = {}
    week_session_ids: set[uuid.UUID] = set()
    for text_user, created_at, session_id in rows.all():
        tokens = tokenize_words(text_user or "")
        if created_at < week_start:
            prior_words.update(tokens)
            continue
        week_session_ids.add(session_id)
        for word in tokens:
            if word in prior_words:
                continue
            counts[word] = counts.get(word, 0) + 1
            first_said.setdefault(word, created_at)

    if not counts:
        return WeeklyReport(week_start=week_start, week_end=now, new_words=[])

    # Curriculum words: the learner's assigned roots, whole subtree.
    curriculum_words: set[str] = set()
    root_rows = await db.execute(
        select(ItemGroupLearner.group_id).where(ItemGroupLearner.learner_id == learner_id)
    )
    group_ids: set[uuid.UUID] = set()
    for (root_id,) in root_rows.all():
        group_ids.update(await get_descendant_group_ids(db, root_id))
    if group_ids:
        item_rows = await db.execute(
            select(LanguageItem.text)
            .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
            .where(ItemGroupMember.group_id.in_(group_ids), LanguageItem.type == "word")
        )
        curriculum_words = {text.lower() for (text,) in item_rows.all()}

    # Stretch words: next unit of every group the learner practiced this week.
    stretch_words: set[str] = set()
    if week_session_ids:
        session_rows = await db.execute(
            select(Session.group_id)
            .where(Session.id.in_(week_session_ids), Session.group_id.is_not(None))
            .distinct()
        )
        for (gid,) in session_rows.all():
            stretch_words.update(item.text.lower() for item in await next_unit_word_items(db, gid))

    new_words = [
        NewWord(
            text=word,
            first_said_at=first_said[word],
            count=count,
            tag=tag_word(word, stretch_words, curriculum_words),
        )
        for word, count in counts.items()
    ]
    # Most-repeated first; alphabetical ties keep the list stable for parents.
    new_words.sort(key=lambda w: (-w.count, w.text))
    return WeeklyReport(week_start=week_start, week_end=now, new_words=new_words)
