"""Volcengine Ark LLM adapter (OpenAI-compatible endpoint).

Ark exposes an OpenAI-compatible REST API, so we use the official `openai`
async client. Same adapter handles chat (invoke / stream) and vision
(invoke_vision); the caller passes a different model per role via the
factory.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from collections.abc import AsyncIterator
from typing import Any, cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from app.adapters.llm.protocol import LLMMessage, LLMResponse
from app.config import settings

log = logging.getLogger(__name__)


def _to_openai_messages(messages: list[LLMMessage]) -> list[ChatCompletionMessageParam]:
    """Adapt our role/content pairs to the OpenAI message-param union (type-only)."""
    return [
        cast(ChatCompletionMessageParam, {"role": m.role, "content": m.content}) for m in messages
    ]


class VolcLLMAdapter:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        vision_model: str | None = None,
    ) -> None:
        self._model = model or settings.volc_ark_model
        self._vision_model = vision_model
        self._client = AsyncOpenAI(
            api_key=api_key or settings.volc_ark_api_key,
            base_url=base_url or settings.volc_ark_base_url,
        )

    async def invoke(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        completion = await self._client.chat.completions.create(
            model=self._model,
            messages=_to_openai_messages(messages),
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choice = completion.choices[0]
        usage = completion.usage
        return LLMResponse(
            text=choice.message.content or "",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            model=completion.model,
            raw=completion.model_dump(),
        )

    async def invoke_vision(
        self,
        prompt: str,
        images: list[bytes],
        *,
        image_mime: str = "image/jpeg",
        temperature: float = 0.2,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> LLMResponse:
        if not self._vision_model:
            raise NotImplementedError("vision_model not configured for VolcLLMAdapter")

        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for image_bytes in images:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{image_mime};base64,{b64}"},
                }
            )

        kwargs: dict[str, Any] = {
            "model": self._vision_model,
            "messages": [{"role": "user", "content": content}],
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if response_format is not None:
            kwargs["response_format"] = response_format

        completion = await self._client.chat.completions.create(**kwargs)
        choice = completion.choices[0]
        usage = completion.usage
        return LLMResponse(
            text=choice.message.content or "",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            model=completion.model,
            raw=completion.model_dump(),
        )

    def stream(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        return self._stream_impl(messages, temperature=temperature, max_tokens=max_tokens)

    async def _stream_impl(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float,
        max_tokens: int | None,
    ) -> AsyncIterator[str]:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=_to_openai_messages(messages),
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        stream = cast(AsyncStream[ChatCompletionChunk], response)
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


async def _smoke_test() -> None:
    """Run as `poetry run python -m app.adapters.llm.volc`."""
    logging.basicConfig(level=logging.INFO)
    adapter = VolcLLMAdapter()
    response = await adapter.invoke(
        [
            LLMMessage(role="system", content="You are a friendly English teacher for kids."),
            LLMMessage(role="user", content="Say hi to me in one short sentence."),
        ],
        max_tokens=64,
    )
    print(f"model:  {response.model}")
    print(f"tokens: in={response.input_tokens}  out={response.output_tokens}")
    print(f"text:   {response.text}")


if __name__ == "__main__":
    asyncio.run(_smoke_test())
