"""Protocol for an LLM provider.

invoke() / stream() / invoke_vision() are all declared from V1. Implementations
may raise NotImplementedError for capabilities the provider does not support
(e.g. DeepSeek does not currently offer vision); the factory picks providers
per role so business code never calls an unsupported method.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


@dataclass(frozen=True)
class LLMMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int
    model: str
    raw: dict = field(default_factory=dict)


class LLMAdapter(Protocol):
    async def invoke(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> LLMResponse: ...

    async def invoke_vision(
        self,
        prompt: str,
        images: list[bytes],
        *,
        image_mime: str = "image/jpeg",
        temperature: float = 0.2,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> LLMResponse: ...

    def stream(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]: ...
