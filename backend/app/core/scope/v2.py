"""Scope Computer V2 — V1 plus "stretch" (i+1) words from the next unit.

Group mode only: the base scope is exactly V1's; on top of it we offer a small
budget of next-unit words (``ceil(stretch_ratio * base words)``, capped) that
the prompt invites the LLM to weave in casually. Selection is mastery-weighted
(glimpsed-but-unmastered words first) and shuffled with a session-seeded RNG —
deterministic within a session, rotating across sessions — so it never needs
to be persisted. See docs/phase2-mastery-stretch.md §3.
"""

from __future__ import annotations

import math
import random
import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_config import app_config
from app.core.scope.protocol import ScopeResult
from app.core.scope.siblings import next_unit_word_items
from app.core.scope.v1 import V1ScopeComputer
from app.storage.models.learning import LearnerItemStats


def select_stretch_words(
    candidates: Sequence[str],
    base_words: Iterable[str],
    stats: Mapping[str, tuple[int, bool]],
    *,
    ratio: float,
    max_words: int,
    seed: int,
) -> list[str]:
    """Pure selection: filter, tier by exposure, session-seeded shuffle, budget.

    ``stats`` maps lowercase word → (seen_count, mastered). Words absent from
    ``stats`` count as never seen.
    """
    base_lower = {w.lower() for w in base_words}
    budget = min(max_words, math.ceil(ratio * len(base_lower)))
    if budget <= 0:
        return []

    seen_words: set[str] = set()
    glimpsed: list[str] = []
    unseen: list[str] = []
    for word in candidates:
        key = word.lower()
        if key in base_lower or key in seen_words:
            continue
        seen_words.add(key)
        seen_count, mastered = stats.get(key, (0, False))
        if mastered:
            continue
        (glimpsed if seen_count > 0 else unseen).append(word)

    rng = random.Random(seed)
    rng.shuffle(glimpsed)
    rng.shuffle(unseen)
    return (glimpsed + unseen)[:budget]


class V2ScopeComputer(V1ScopeComputer):
    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        group_id: uuid.UUID | None,
        session_id: uuid.UUID | None = None,
    ) -> ScopeResult:
        scope = await super().get_scope(db, learner_id, group_id, session_id)
        cfg = app_config.scope
        if scope.mode != "group" or group_id is None or cfg.stretch_ratio <= 0 or not scope.words:
            return scope

        items = await next_unit_word_items(db, group_id)
        if not items:
            return scope

        stats_rows = await db.execute(
            select(
                LearnerItemStats.item_id,
                LearnerItemStats.seen_count,
                LearnerItemStats.mastered_at,
            ).where(
                LearnerItemStats.learner_id == learner_id,
                LearnerItemStats.item_id.in_([i.id for i in items]),
            )
        )
        stats_by_item = {row.item_id: row for row in stats_rows.all()}
        stats: dict[str, tuple[int, bool]] = {}
        for item in items:
            row = stats_by_item.get(item.id)
            if row is not None:
                stats[item.text.lower()] = (row.seen_count, row.mastered_at is not None)

        seed_uuid = session_id if session_id is not None else learner_id
        scope.stretch_words = select_stretch_words(
            [i.text for i in items],
            scope.words,
            stats,
            ratio=cfg.stretch_ratio,
            max_words=cfg.stretch_max_words,
            seed=seed_uuid.int,
        )
        if scope.stretch_words:
            scope.stretch_ratio = cfg.stretch_ratio
        return scope
