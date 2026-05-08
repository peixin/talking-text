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


async def _require_learner(learner_id: uuid.UUID, account: Account, db: AsyncSession) -> Learner:
    row = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
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
    rows = await db.execute(select(Curriculum).where(Curriculum.is_public.is_(True)))
    return list(rows.scalars().all())


@router.get("/curricula/{curriculum_id}/lessons", response_model=CurriculumLessonsOut)
async def get_curriculum_lessons(
    curriculum_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _account: Annotated[Account, Depends(get_current_account)],
) -> CurriculumLessonsOut:
    curr_row = await db.execute(select(Curriculum).where(Curriculum.id == curriculum_id))
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
                    LessonSummary(id=l.id, sequence=l.sequence, title=l.title) for l in lessons
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
    lesson_row = await db.execute(
        select(CurriculumLesson).where(CurriculumLesson.id == body.lesson_id)
    )
    if not lesson_row.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Lesson not found")
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
