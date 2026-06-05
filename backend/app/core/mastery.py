"""Mastery data collection — anchor-scan per turn + LLM analysis per session.

Fire-and-forget background tasks invoked by the dialog orchestrator. Both
update ``learner_item_stats``; neither blocks the chat reply path.

V1 collects only — there is no UI consuming these stats yet. See dev log §11
notes on threshold tuning and the open question on multi-session mastery.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import factory
from app.adapters.llm.protocol import LLMMessage
from app.app_config import app_config
from app.storage.db import _SessionFactory
from app.storage.models.content import ItemGroupMember, LanguageItem, get_descendant_group_ids
from app.storage.models.learning import LearnerItemStats
from app.storage.models.session import Session
from app.storage.models.turn import Turn

log = logging.getLogger(__name__)

# Mastery threshold — keep generous for V1; revisit with real data.
_MASTERY_CORRECT_THRESHOLD = 3


# ── Anchor scan (per-turn) ───────────────────────────────────────────────────


async def scan_turn_for_items(
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    text_user: str,
) -> None:
    """Update seen_count + last_seen for any scope items detected in the turn.

    Background task; never raises. No-op when the session is not anchored to
    a group (free / calibration mode have no scope items to track).
    """
    text = (text_user or "").lower().strip()
    if not text:
        return
    try:
        async with _SessionFactory() as db:
            row = await db.execute(select(Session.group_id).where(Session.id == session_id))
            group_id = row.scalar_one_or_none()
            if group_id is None:
                return

            items = await _scope_items(db, group_id)
            matched_ids = [item.id for item in items if item.anchor and item.anchor in text]
            if not matched_ids:
                return

            now = datetime.now(UTC)
            stmt = (
                pg_insert(LearnerItemStats)
                .values(
                    [
                        {
                            "learner_id": learner_id,
                            "item_id": item_id,
                            "seen_count": 1,
                            "last_seen": now,
                        }
                        for item_id in matched_ids
                    ]
                )
                .on_conflict_do_update(
                    index_elements=["learner_id", "item_id"],
                    set_={
                        "seen_count": LearnerItemStats.__table__.c.seen_count + 1,
                        "last_seen": now,
                    },
                )
            )
            await db.execute(stmt)
            await db.commit()
    except Exception:
        log.exception("mastery anchor-scan failed")


# ── Session-end LLM analysis ─────────────────────────────────────────────────


_ANALYSIS_PROMPT = (
    "You are reviewing a short English practice chat between Tina (the AI tutor) "
    "and a young learner. Below is a list of TARGET ITEMS the lesson covers and "
    "the full transcript. Identify which target items the CHILD actually USED "
    "(not Tina), and of those uses, which were CORRECT.\n\n"
    "Output ONLY a JSON object: "
    '{"used": [item_text, ...], "correct": [item_text, ...]}. '
    "Match items exactly by their text. For pattern items (containing ___), "
    "count as used if the child produced the fixed part in context. Empty "
    "arrays are valid. Do not include any other commentary."
)


async def analyze_session(learner_id: uuid.UUID, session_id: uuid.UUID) -> None:
    """LLM-driven analysis: which items did the child use and use correctly?

    Updates ``used_count`` / ``correct_count`` / ``mastered_at`` on
    ``learner_item_stats``. Background task; never raises. No-op when the
    session is not anchored to a group.
    """
    try:
        async with _SessionFactory() as db:
            session_row = await db.execute(select(Session.group_id).where(Session.id == session_id))
            group_id = session_row.scalar_one_or_none()
            if group_id is None:
                return

            items = await _scope_items(db, group_id)
            if not items:
                return

            transcript = await _build_transcript(db, session_id)
            if not transcript:
                return

            item_lines = "\n".join(f"- ({i.type}) {i.text}" for i in items if i.text)
            user_msg = f"TARGET ITEMS:\n{item_lines}\n\nTRANSCRIPT:\n{transcript}"

            try:
                task = app_config.task("mastery")
                response = await factory.chat.invoke(
                    [
                        LLMMessage(role="system", content=_ANALYSIS_PROMPT),
                        LLMMessage(role="user", content=user_msg),
                    ],
                    temperature=task.temperature,
                    max_tokens=task.max_tokens,
                )
            except Exception:
                log.exception("session analysis LLM call failed")
                return

            parsed = _parse_analysis(response.text)
            if parsed is None:
                return

            used_set = {s.strip() for s in parsed.get("used", []) if isinstance(s, str)}
            correct_set = {s.strip() for s in parsed.get("correct", []) if isinstance(s, str)}
            text_to_id = {item.text: item.id for item in items}
            used_ids = [text_to_id[t] for t in used_set if t in text_to_id]
            correct_ids = [text_to_id[t] for t in correct_set if t in text_to_id]
            if not used_ids and not correct_ids:
                return

            now = datetime.now(UTC)

            if used_ids:
                await _bump_counts(db, learner_id, used_ids, "used_count", now)
            if correct_ids:
                await _bump_counts(db, learner_id, correct_ids, "correct_count", now)

            # Mark anything that has crossed the mastery threshold and isn't
            # already flagged.
            await db.execute(
                update(LearnerItemStats)
                .where(
                    LearnerItemStats.learner_id == learner_id,
                    LearnerItemStats.correct_count >= _MASTERY_CORRECT_THRESHOLD,
                    LearnerItemStats.mastered_at.is_(None),
                )
                .values(mastered_at=now)
            )
            await db.commit()
            log.info(
                "session analysis: session=%s used=%d correct=%d",
                session_id,
                len(used_ids),
                len(correct_ids),
            )
    except Exception:
        log.exception("session analysis failed")


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _scope_items(db: AsyncSession, group_id: uuid.UUID) -> list[LanguageItem]:
    descendant_ids = await get_descendant_group_ids(db, group_id)
    rows = await db.execute(
        select(LanguageItem)
        .join(ItemGroupMember, ItemGroupMember.item_id == LanguageItem.id)
        .where(ItemGroupMember.group_id.in_(descendant_ids))
    )
    return list(rows.scalars().all())


async def _build_transcript(db: AsyncSession, session_id: uuid.UUID) -> str:
    rows = await db.execute(
        select(Turn.text_user, Turn.text_ai)
        .where(Turn.session_id == session_id)
        .order_by(Turn.sequence.asc())
    )
    lines: list[str] = []
    for text_user, text_ai in rows:
        if text_user:
            lines.append(f"Child: {text_user}")
        if text_ai:
            lines.append(f"Tina: {text_ai}")
    return "\n".join(lines)


async def _bump_counts(
    db: AsyncSession,
    learner_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    field: str,
    now: datetime,
) -> None:
    """Increment `field` (used_count or correct_count) for each item_id."""
    col = LearnerItemStats.__table__.c[field]
    stmt = (
        pg_insert(LearnerItemStats)
        .values(
            [
                {
                    "learner_id": learner_id,
                    "item_id": item_id,
                    field: 1,
                    "last_seen": now,
                }
                for item_id in item_ids
            ]
        )
        .on_conflict_do_update(
            index_elements=["learner_id", "item_id"],
            set_={
                field: col + 1,
                "last_seen": func.greatest(LearnerItemStats.__table__.c.last_seen, now),
            },
        )
    )
    await db.execute(stmt)


def _parse_analysis(raw: str) -> dict | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        log.warning("session analysis returned non-JSON: %r", raw[:300])
        return None
    if not isinstance(data, dict):
        return None
    return data
