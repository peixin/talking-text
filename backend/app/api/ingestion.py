import base64
import json
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters import factory
from app.adapters.llm.protocol import LLMMessage
from app.api.auth import get_current_account
from app.storage.db import get_db
from app.storage.models.account import Account
from app.storage.models.collection import Collection, CollectionItem
from app.storage.models.curriculum import (
    Curriculum,
    CurriculumLesson,
    CurriculumUnit,
    LanguageItem,
    LessonItem,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["ingestion"])

class LanguageItemExtracted(BaseModel):
    text: str
    type: str  # word | phrase | pattern
    anchor: str | None = None

class IngestionResult(BaseModel):
    items: list[LanguageItemExtracted]
    notes: str | None = None

@router.post("/ingest/extract", response_model=IngestionResult)
async def extract_content(
    _account: Annotated[Account, Depends(get_current_account)],
    description: Annotated[str, Form()] = "",
    images: Annotated[list[UploadFile] | None, File()] = None,
) -> IngestionResult:
    """Extract language items from optional images and description."""
    
    if not description and not images:
        raise HTTPException(status_code=400, detail="Must provide either text description or images")
    
    # Construct vision prompt
    if images:
        prompt = f"""
        You are an AI assistant helping to ingest language learning materials (textbooks, worksheets).
        A user has uploaded {len(images)} image(s) and provided this description: "{description}"
        
        Tasks:
        1. OCR the relevant language content from the image(s).
        2. Extract key learning items: Words, Phrases, and Sentence Patterns.
        3. For 'pattern', provide an 'anchor' which is the fixed lowercase part of the pattern (e.g., "how about" for "How about ...?").
        4. For 'word' and 'phrase', anchor is not needed.
        5. Return the result strictly in valid JSON format.
        
        Format:
        {{
          "items": [
            {{ "text": "apple", "type": "word" }},
            {{ "text": "How about...?", "type": "pattern", "anchor": "how about" }}
          ],
          "notes": "Brief summary of the content extracted"
        }}
        """
    else:
        prompt = f"""
        You are an AI assistant helping to ingest language learning materials.
        A user has provided this description/text: "{description}"
        
        Tasks:
        1. Extract key learning items: Words, Phrases, and Sentence Patterns from the text.
        2. For 'pattern', provide an 'anchor' which is the fixed lowercase part of the pattern (e.g., "how about" for "How about ...?").
        3. For 'word' and 'phrase', anchor is not needed.
        4. Return the result strictly in valid JSON format.
        
        Format:
        {{
          "items": [
            {{ "text": "apple", "type": "word" }},
            {{ "text": "How about...?", "type": "pattern", "anchor": "how about" }}
          ],
          "notes": "Brief summary of the content extracted"
        }}
        """

    content_list: list[dict] = [{"type": "text", "text": prompt}]
    
    has_valid_images = False
    if images:
        for image in images:
            if not image.filename:
                continue
            has_valid_images = True
            try:
                image_bytes = await image.read()
                image_b64 = base64.b64encode(image_bytes).decode("utf-8")
                content_list.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{image.content_type or 'image/jpeg'};base64,{image_b64}"}
                })
            except Exception as e:
                log.error(f"Failed to read upload: {e}")
                raise HTTPException(status_code=400, detail="Invalid image file")
    
    messages = [LLMMessage(role="user", content=content_list)]
    
    try:
        if has_valid_images:
            response = await factory.ocr.invoke_vision(
                messages, 
                max_tokens=2048,
                response_format={"type": "json_object"}
            )
        else:
            # text-only, we can just use the main LLM with string content
            text_messages = [LLMMessage(role="user", content=prompt)]
            response = await factory.llm.invoke(
                text_messages,
                max_tokens=2048,
                response_format={"type": "json_object"}
            )
            
        content = response.text.strip()
        data = json.loads(content)
        return IngestionResult(**data)
    except json.JSONDecodeError:
        log.error(f"AI returned invalid JSON: {response.text}")
        raise HTTPException(status_code=500, detail="AI returned invalid data format")
    except Exception as e:
        log.exception("AI extraction failed")
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")

# ── Save Schemas ─────────────────────────────────────────────────────────────

class SaveToLessonBody(BaseModel):
    items: list[LanguageItemExtracted]
    curriculum_name: str
    unit_number: str | None = "1"
    unit_title: str | None = "General"
    lesson_title: str | None = "New Lesson"

class SaveToCollectionBody(BaseModel):
    items: list[LanguageItemExtracted]
    collection_id: uuid.UUID | None = None
    new_collection_name: str | None = None
    learner_id: uuid.UUID

# ── Save Routes ──────────────────────────────────────────────────────────────

async def _get_or_create_item(db: AsyncSession, item: LanguageItemExtracted) -> LanguageItem:
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

@router.post("/ingest/save-to-lesson")
async def save_to_lesson(
    body: SaveToLessonBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 1. Find or create Curriculum
    curr_row = await db.execute(
        select(Curriculum).where(Curriculum.name == body.curriculum_name, Curriculum.owner_account_id == account.id)
    )
    curriculum = curr_row.scalar_one_or_none()
    if not curriculum:
        curriculum = Curriculum(name=body.curriculum_name, owner_account_id=account.id, is_public=False)
        db.add(curriculum)
        await db.flush()

    # 2. Find or create Unit
    unit_row = await db.execute(
        select(CurriculumUnit).where(
            CurriculumUnit.curriculum_id == curriculum.id,
            CurriculumUnit.unit_number == (body.unit_number or "1")
        )
    )
    unit = unit_row.scalar_one_or_none()
    if not unit:
        unit = CurriculumUnit(
            curriculum_id=curriculum.id,
            unit_number=body.unit_number or "1",
            title=body.unit_title or "General",
            sequence=1 # simplistic
        )
        db.add(unit)
        await db.flush()

    # 3. Create Lesson
    lesson = CurriculumLesson(
        unit_id=unit.id,
        title=body.lesson_title,
        sequence=1 # simplistic
    )
    db.add(lesson)
    await db.flush()

    # 4. Add items
    for item_extracted in body.items:
        item = await _get_or_create_item(db, item_extracted)
        await db.flush()
        db.add(LessonItem(lesson_id=lesson.id, item_id=item.id))
    
    await db.commit()
    return {"lesson_id": lesson.id}

@router.post("/ingest/save-to-collection")
async def save_to_collection(
    body: SaveToCollectionBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Verify learner ownership
    from app.api.collection import _require_learner
    await _require_learner(body.learner_id, account, db)

    collection_id = body.collection_id
    if not collection_id:
        if not body.new_collection_name:
            raise HTTPException(status_code=400, detail="Collection ID or name required")
        new_coll = Collection(
            name=body.new_collection_name,
            owner_learner_id=body.learner_id
        )
        db.add(new_coll)
        await db.flush()
        collection_id = new_coll.id
    
    for item_extracted in body.items:
        item = await _get_or_create_item(db, item_extracted)
        await db.flush()
        
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
    return {"collection_id": collection_id}
