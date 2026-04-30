"""Protocol for a text-to-speech provider.

V1 returns the entire audio blob in invoke(); V2 will use stream() so the
browser can start playing while synthesis is still in progress.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol

AudioFormat = Literal["mp3", "ogg_opus", "pcm"]


@dataclass(frozen=True)
class TTSRequest:
    text: str
    voice: str
    audio_format: AudioFormat = "mp3"
    sample_rate: int = 24000


@dataclass(frozen=True)
class TTSResult:
    audio: bytes
    audio_format: AudioFormat
    sample_rate: int
    voice: str
    chars: int  # billable character count
    raw: dict = field(default_factory=dict)


class TTSAdapter(Protocol):
    async def invoke(self, request: TTSRequest) -> TTSResult: ...

    def stream(self, request: TTSRequest) -> AsyncIterator[bytes]: ...
