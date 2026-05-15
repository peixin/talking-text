from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Literal, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

ScopeMode = Literal["calibration", "free", "group"]


@dataclass(frozen=True)
class PatternItem:
    text: str  # "I like ___ and ___."
    anchor: str  # "i like"  (lowercase fixed substring for detection)


@dataclass
class ScopeResult:
    mode: ScopeMode = "free"
    # For "free" and "calibration" modes: working CEFR level (may be None
    # during calibration before settling).
    cefr_level: str | None = None
    # For "group" mode only:
    words: list[str] = field(default_factory=list)
    phrases: list[str] = field(default_factory=list)
    patterns: list[PatternItem] = field(default_factory=list)
    prompt_notes: str | None = None

    @property
    def is_empty(self) -> bool:
        return not self.words and not self.phrases and not self.patterns


class ScopeComputer(Protocol):
    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: uuid.UUID,
        group_id: uuid.UUID | None,
    ) -> ScopeResult: ...
