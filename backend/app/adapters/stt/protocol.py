"""Protocol for a speech-to-text provider.

V1 only needs invoke() with the full audio bytes. V2 will use stream() to feed
audio chunks as they arrive from the browser, in service of the streaming voice
pipeline (architecture rule #4).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol

# Volcengine seedasr accepts ogg/opus, pcm, wav, mp3.
AudioFormat = Literal["ogg", "pcm", "wav", "mp3"]


@dataclass(frozen=True)
class STTRequest:
    audio: bytes
    audio_format: AudioFormat
    sample_rate: int = 16000
    language: str | None = None  # None = auto / multi-lingual


@dataclass(frozen=True)
class STTResult:
    text: str
    audio_seconds: float
    raw: dict = field(default_factory=dict)


class STTAdapter(Protocol):
    async def invoke(self, request: STTRequest) -> STTResult: ...

    def stream(
        self, audio_chunks: AsyncIterator[bytes], *, audio_format: AudioFormat, sample_rate: int
    ) -> AsyncIterator[STTResult]: ...
