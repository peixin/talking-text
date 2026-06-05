"""Protocols for LLM providers, segregated by input capability.

Two roles, because some models accept only text while others also accept images
(and later audio / documents):

- ``TextLLM``       — text in, text out (chat). Every provider supports this.
- ``MultimodalLLM`` — a ``TextLLM`` whose configured model also accepts non-text
                      parts. ``modalities`` advertises what it accepts; the
                      factory validates the wired model before exposing it.

Business code depends on the *narrowest* role it needs, so a text-only model can
never be wired into a multimodal call site. The wire format is identical OpenAI
chat-completions either way (image/audio ride as content parts), so a single
``OpenAICompatibleLLMAdapter`` implements both — see ``openai_compatible.py``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

Modality = Literal["text", "image", "audio", "document"]


@dataclass(frozen=True)
class ImagePart:
    """An image attachment within a multimodal message's content."""

    data: bytes
    mime: str = "image/jpeg"


# A message's content is either plain text, or an ordered list of parts
# (text and/or images). The list form mirrors OpenAI's content-parts shape.
MessageContent = str | list[str | ImagePart]


@dataclass(frozen=True)
class LLMMessage:
    role: Literal["system", "user", "assistant"]
    content: MessageContent


@dataclass(frozen=True)
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int
    model: str
    raw: dict = field(default_factory=dict)


class TextLLM(Protocol):
    async def invoke(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
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


class MultimodalLLM(TextLLM, Protocol):
    # The set of content kinds the configured model accepts (always includes
    # "text"). Lets callers/factory check capability without a separate method.
    modalities: frozenset[Modality]
