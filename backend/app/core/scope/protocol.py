from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class PatternItem:
    text: str  # "I like ___ and ___."
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
