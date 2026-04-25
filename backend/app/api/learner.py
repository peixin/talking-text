import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.learner import Learner

router = APIRouter(prefix="/learners", tags=["learners"])


class LearnerCreate(BaseModel):
    name: str


class LearnerUpdate(BaseModel):
    name: str


class LearnerOut(BaseModel):
    id: uuid.UUID
    name: str


@router.get("")
async def list_learners(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[LearnerOut]:
    result = await db.execute(
        select(Learner).where(Learner.account_id == account.id).order_by(Learner.created_at.desc())
    )
    learners = result.scalars().all()
    return [LearnerOut(id=l.id, name=l.name) for l in learners]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_learner(
    body: LearnerCreate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    learner = Learner(account_id=account.id, name=body.name)
    db.add(learner)
    await db.commit()
    await db.refresh(learner)
    return LearnerOut(id=learner.id, name=learner.name)


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
    return LearnerOut(id=learner.id, name=learner.name)


@router.delete("/{learner_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    return LearnerOut(id=learner.id, name=learner.name)
