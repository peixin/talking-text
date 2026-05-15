import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.collection import Collection, CollectionItem
from app.storage.models.curriculum import LanguageItem
from app.storage.models.learner import Learner

router = APIRouter(tags=["collection"])

# ── Schemas ──────────────────────────────────────────────────────────────────

class CollectionSummary(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_public: bool

    model_config = {"from_attributes": True}

class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    is_public: bool = False

class LanguageItemIn(BaseModel):
    text: str
    type: str  # word|phrase|pattern
    anchor: str | None = None

class CollectionItemsUpdate(BaseModel):
    items: list[LanguageItemIn]

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _require_learner(learner_id: uuid.UUID, account: Account, db: AsyncSession) -> Learner:
    row = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = row.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    return learner

async def _get_or_create_item(db: AsyncSession, item: LanguageItemIn) -> LanguageItem:
    row = await db.execute(
        select(LanguageItem).where(LanguageItem.type == item.type, LanguageItem.text == item.text)
    )
    existing = row.scalar_one_or_none()
    if existing:
        return existing
    
    new_item = LanguageItem(
        type=item.type,
        text=item.text,
        anchor=item.anchor or item.text.lower()
    )
    db.add(new_item)
    return new_item

# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/learners/{learner_id}/collections", response_model=list[CollectionSummary])
async def list_collections(
    learner_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    account: Annotated[Account, Depends(get_current_account)],
) -> list[Collection]:
    await _require_learner(learner_id, account, db)
    rows = await db.execute(
        select(Collection).where(Collection.owner_learner_id == learner_id)
    )
    return list(rows.scalars().all())

@router.post("/learners/{learner_id}/collections", response_model=CollectionSummary)
async def create_collection(
    learner_id: uuid.UUID,
    body: CollectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    account: Annotated[Account, Depends(get_current_account)],
) -> Collection:
    await _require_learner(learner_id, account, db)
    new_coll = Collection(
        name=body.name,
        description=body.description,
        owner_learner_id=learner_id,
        is_public=body.is_public
    )
    db.add(new_coll)
    await db.commit()
    await db.refresh(new_coll)
    return new_coll

@router.post("/collections/{collection_id}/items", status_code=status.HTTP_204_NO_CONTENT)
async def add_items_to_collection(
    collection_id: uuid.UUID,
    body: CollectionItemsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    account: Annotated[Account, Depends(get_current_account)],
) -> None:
    # Check ownership
    coll_row = await db.execute(
        select(Collection).where(Collection.id == collection_id)
    )
    collection = coll_row.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    # Ensure account owns the learner who owns the collection
    await _require_learner(collection.owner_learner_id, account, db)

    for item_in in body.items:
        item = await _get_or_create_item(db, item_in)
        await db.flush() # ensure item.id is available
        
        # Check if already in collection
        exists_row = await db.execute(
            select(CollectionItem).where(
                CollectionItem.collection_id == collection_id,
                CollectionItem.item_id == item.id
            )
        )
        if not exists_row.scalar_one_or_none():
            db.add(CollectionItem(collection_id=collection_id, item_id=item.id))
    
    await db.commit()

class CollectionItemOut(BaseModel):
    id: uuid.UUID
    text: str
    type: str
    anchor: str | None

    model_config = {"from_attributes": True}

@router.get("/collections/{collection_id}/items", response_model=list[CollectionItemOut])
async def get_collection_items(
    collection_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    account: Annotated[Account, Depends(get_current_account)],
) -> list[LanguageItem]:
    coll_row = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = coll_row.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    await _require_learner(collection.owner_learner_id, account, db)

    rows = await db.execute(
        select(LanguageItem)
        .join(CollectionItem, CollectionItem.item_id == LanguageItem.id)
        .where(CollectionItem.collection_id == collection_id)
    )
    return list(rows.scalars().all())
