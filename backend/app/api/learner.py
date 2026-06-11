import json
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.factory import chat as llm
from app.adapters.llm.protocol import LLMMessage
from app.api.auth import get_current_account
from app.app_config import app_config
from app.core.report import weekly_new_words
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner

router = APIRouter(prefix="/learners", tags=["learners"])


class LearnerCreate(BaseModel):
    name: str
    cefr_level: str | None = None  # one of A1..C2, or None for "not sure / let Tina calibrate"


class LearnerUpdate(BaseModel):
    name: str


class LearnerOut(BaseModel):
    id: uuid.UUID
    name: str
    ai_name: str
    ai_gender: str
    ai_persona_prompt: str | None
    correction_level: str
    cefr_level: str | None


class UpdatePersonaBody(BaseModel):
    ai_name: str | None = None
    ai_gender: str | None = None
    ai_persona_prompt: str | None = None
    correction_level: Literal["gentle", "strict", "native"] | None = None


class SyncPersonaBody(BaseModel):
    ai_name: str
    ai_gender: str
    ai_persona_prompt: str


_SYNC_PROMPT = """\
You help parents customize an AI tutor persona for a children's English learning app.

Given:
- AI name: {name}
- AI gender: {gender}  (options: female / male / neutral)
- Persona prompt: {prompt}

Task: Return a JSON object with exactly three keys: "ai_name", "ai_gender", "ai_persona_prompt".

Rules:
1. The name used inside the prompt must match the given AI name. Update if they differ.
2. Gender pronouns in the prompt must match the given gender. Update if they differ.
3. If the prompt does not mention gender pronouns at all, append the appropriate sentence:
   - female → "She uses she/her pronouns."
   - male   → "He uses he/him pronouns."
   - neutral → "They use they/them pronouns."
4. Preserve all other content in the prompt exactly.
5. Return only valid JSON — no explanation, no code fences.\
"""


_VALID_CEFR = {"A1", "A2", "B1", "B2", "C1", "C2"}


def _normalize_cefr(value: str | None) -> str | None:
    if value is None:
        return None
    upper = value.strip().upper()
    if upper not in _VALID_CEFR:
        return None
    return upper


def _learner_out(l: Learner) -> LearnerOut:
    return LearnerOut(
        id=l.id,
        name=l.name,
        ai_name=l.ai_name,
        ai_gender=l.ai_gender,
        ai_persona_prompt=l.ai_persona_prompt,
        correction_level=l.correction_level,
        cefr_level=l.cefr_level,
    )


@router.get("")
async def list_learners(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[LearnerOut]:
    result = await db.execute(
        select(Learner).where(Learner.account_id == account.id).order_by(Learner.created_at.desc())
    )
    learners = result.scalars().all()
    return [_learner_out(l) for l in learners]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_learner(
    body: LearnerCreate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    learner = Learner(
        account_id=account.id,
        name=body.name.strip(),
        cefr_level=_normalize_cefr(body.cefr_level),
    )
    db.add(learner)
    await db.flush()
    # First learner created in this account → make it the active one so chat
    # picks it up without an extra setActive call.
    if account.last_active_learner_id is None:
        account.last_active_learner_id = learner.id
    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)


@router.put("/{learner_id}")
async def update_learner(
    learner_id: uuid.UUID,
    body: LearnerUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    learner.name = body.name
    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)


@router.delete("/{learner_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_learner(
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    await db.delete(learner)
    await db.commit()


@router.put("/{learner_id}/active", status_code=status.HTTP_200_OK)
async def set_active_learner(
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    account.last_active_learner_id = learner.id
    await db.commit()
    return _learner_out(learner)


class NewWordOut(BaseModel):
    text: str
    first_said_at: datetime
    count: int
    tag: str  # stretch | curriculum | wild


class WeeklyReportOut(BaseModel):
    week_start: datetime
    week_end: datetime
    new_words: list[NewWordOut]


@router.get("/{learner_id}/report/weekly")
async def weekly_report(
    learner_id: uuid.UUID,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WeeklyReportOut:
    """New words the child produced in the last 7 days — a plain list, no charts."""
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Learner not found")

    report = await weekly_new_words(db, learner_id)
    return WeeklyReportOut(
        week_start=report.week_start,
        week_end=report.week_end,
        new_words=[
            NewWordOut(text=w.text, first_said_at=w.first_said_at, count=w.count, tag=w.tag)
            for w in report.new_words
        ],
    )


@router.patch("/{learner_id}/persona")
async def update_persona(
    learner_id: uuid.UUID,
    body: UpdatePersonaBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    if body.ai_name is not None:
        learner.ai_name = body.ai_name
    if body.ai_gender is not None:
        learner.ai_gender = body.ai_gender
    if body.ai_persona_prompt is not None:
        learner.ai_persona_prompt = body.ai_persona_prompt
    if body.correction_level is not None:
        learner.correction_level = body.correction_level

    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)


@router.post("/{learner_id}/persona/sync")
async def sync_persona(
    learner_id: uuid.UUID,
    body: SyncPersonaBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    user_msg = _SYNC_PROMPT.format(
        name=body.ai_name,
        gender=body.ai_gender,
        prompt=body.ai_persona_prompt,
    )
    persona_task = app_config.task("persona")
    response = await llm.invoke(
        [LLMMessage(role="user", content=user_msg)],
        temperature=persona_task.temperature,
        max_tokens=persona_task.max_tokens,
    )
    try:
        synced = json.loads(response.text)
        learner.ai_name = str(synced["ai_name"])
        learner.ai_gender = str(synced["ai_gender"])
        learner.ai_persona_prompt = str(synced["ai_persona_prompt"])
    except (json.JSONDecodeError, KeyError):
        # LLM returned unparseable JSON — save the submitted values as-is
        learner.ai_name = body.ai_name
        learner.ai_gender = body.ai_gender
        learner.ai_persona_prompt = body.ai_persona_prompt

    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)
