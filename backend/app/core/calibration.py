"""CEFR calibration — observe a learner's first few turns and lock in a level.

Runs as a background task fired by the dialog orchestrator after each turn is
committed. While ``learner.cefr_level`` is NULL, every learner utterance gets
estimated by a small LLM call; once the estimates settle (three consecutive
agree, or modal of the first five turns), the learner is locked at that level
and no further rows are produced.

See docs/2026-05-15-dev-log.md §11 for the design notes.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from collections import Counter

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import factory
from app.adapters.llm.protocol import LLMMessage
from app.storage.db import _SessionFactory
from app.storage.models.learner import Learner
from app.storage.models.learning import LearnerCalibrationTurn

log = logging.getLogger(__name__)

_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
_CONFIDENCES = ("high", "medium", "low")

# Settling thresholds — see dev log §11.
_EARLY_SETTLE_TURNS = 3
_MIN_TURNS_FOR_MODE = 5
_MAX_INITIAL_LEVEL_INDEX = 2  # cap initial settle at B1 to avoid optimistic overshoot

_ESTIMATOR_PROMPT = (
    "You are evaluating one short utterance from a young English learner. "
    'Output ONLY a JSON object: {"estimated_level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2", '
    '"confidence": "high"|"medium"|"low", "evidence": "<= 80 chars"}. '
    "Judge only the English content; ignore any code-switching to Chinese. "
    "Single-word replies tend to be A1. Short full sentences A1-A2. "
    "Rich, multi-clause sentences A2-B1. Anything more advanced is rare for "
    "first-time elementary learners."
)


async def estimate_and_maybe_settle(
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    turn_sequence: int,
    learner_text: str,
) -> None:
    """Fire-and-forget background task; never raises."""
    text = (learner_text or "").strip()
    if not text:
        return
    try:
        async with _SessionFactory() as db:
            if not await _needs_calibration(db, learner_id):
                return

            estimate = await _call_estimator(text)
            if estimate is None:
                return

            db.add(
                LearnerCalibrationTurn(
                    learner_id=learner_id,
                    session_id=session_id,
                    turn_sequence=turn_sequence,
                    estimated_level=estimate["level"],
                    confidence=estimate["confidence"],
                    evidence=estimate.get("evidence"),
                )
            )
            await db.commit()

            await _maybe_settle(db, learner_id)
    except Exception:
        log.exception("calibration background task failed")


async def _needs_calibration(db: AsyncSession, learner_id: uuid.UUID) -> bool:
    row = await db.execute(select(Learner.cefr_level).where(Learner.id == learner_id))
    return row.scalar_one_or_none() is None


async def _call_estimator(text: str) -> dict | None:
    """One small LLM call; returns None on any parsing problem."""
    try:
        response = await factory.chat.invoke(
            [
                LLMMessage(role="system", content=_ESTIMATOR_PROMPT),
                LLMMessage(role="user", content=text),
            ],
            temperature=0.0,
            max_tokens=200,
        )
    except Exception:
        log.exception("calibration estimator LLM call failed")
        return None

    cleaned = response.text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        log.warning("calibration estimator returned non-JSON: %r", response.text[:200])
        return None

    level = data.get("estimated_level")
    confidence = data.get("confidence")
    if level not in _LEVELS or confidence not in _CONFIDENCES:
        return None
    return {
        "level": level,
        "confidence": confidence,
        "evidence": (data.get("evidence") or None),
    }


async def _maybe_settle(db: AsyncSession, learner_id: uuid.UUID) -> None:
    rows = await db.execute(
        select(LearnerCalibrationTurn.estimated_level)
        .where(LearnerCalibrationTurn.learner_id == learner_id)
        .order_by(LearnerCalibrationTurn.created_at.asc())
    )
    levels = [r[0] for r in rows]
    if len(levels) < _EARLY_SETTLE_TURNS:
        return

    chosen: str | None = None
    if len(set(levels[-_EARLY_SETTLE_TURNS:])) == 1:
        chosen = levels[-1]
    elif len(levels) >= _MIN_TURNS_FOR_MODE:
        chosen = Counter(levels).most_common(1)[0][0]
    if not chosen:
        return

    capped = _LEVELS[min(_LEVELS.index(chosen), _MAX_INITIAL_LEVEL_INDEX)]
    await db.execute(update(Learner).where(Learner.id == learner_id).values(cefr_level=capped))
    await db.commit()
    log.info("calibration settled learner=%s level=%s", learner_id, capped)
