"""One adapter for every OpenAI-compatible LLM endpoint.

Volcengine Ark, DeepSeek, Aliyun DashScope, Tencent Hunyuan, Xiaomi, … all
expose the OpenAI ``/chat/completions`` shape, so they differ only in data:
base URL, API key, model id, and a few per-vendor knobs (``extra_body``,
``reasoning_effort``). Adding a provider is a factory + config change, never a
new class.

The same instance satisfies both ``TextLLM`` and ``MultimodalLLM`` — text and
images travel through the identical ``invoke``; ``modalities`` records what the
configured model actually accepts.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from collections.abc import AsyncIterator
from typing import Any, cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from app.adapters.llm.protocol import ImagePart, LLMMessage, LLMResponse, Modality

log = logging.getLogger(__name__)


def _to_openai_messages(messages: list[LLMMessage]) -> list[ChatCompletionMessageParam]:
    """Adapt our role/content pairs to the OpenAI message-param union."""
    out: list[dict[str, Any]] = []
    for m in messages:
        if isinstance(m.content, str):
            out.append({"role": m.role, "content": m.content})
            continue
        parts: list[dict[str, Any]] = []
        for part in m.content:
            if isinstance(part, ImagePart):
                b64 = base64.b64encode(part.data).decode("ascii")
                parts.append(
                    {"type": "image_url", "image_url": {"url": f"data:{part.mime};base64,{b64}"}}
                )
            else:  # str
                parts.append({"type": "text", "text": part})
        out.append({"role": m.role, "content": parts})
    return [cast(ChatCompletionMessageParam, m) for m in out]


class OpenAICompatibleLLMAdapter:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        modalities: frozenset[Modality] = frozenset({"text"}),
        extra_body: dict[str, Any] | None = None,
        reasoning_effort: str | None = None,
    ) -> None:
        self._model = model
        self.modalities = modalities
        self._extra_body = extra_body or {}
        self._reasoning_effort = reasoning_effort
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    def _build_kwargs(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float,
        max_tokens: int | None,
        response_format: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": _to_openai_messages(messages),
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if response_format is not None:
            kwargs["response_format"] = response_format
        if self._extra_body:
            kwargs["extra_body"] = self._extra_body
        if self._reasoning_effort:
            kwargs["reasoning_effort"] = self._reasoning_effort
        if stream:
            kwargs["stream"] = True
        return kwargs

    async def invoke(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> LLMResponse:
        completion = await self._client.chat.completions.create(
            **self._build_kwargs(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
            )
        )
        choice = completion.choices[0]
        if choice.finish_reason == "length":
            # A truncated response is fatal for JSON tasks (extraction) — surface it.
            log.warning(
                "%s response truncated at max_tokens=%s; raise the [task.*] budget",
                self._model,
                max_tokens,
            )
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
            **self._build_kwargs(
                messages, temperature=temperature, max_tokens=max_tokens, stream=True
            )
        )
        stream = cast(AsyncStream[ChatCompletionChunk], response)
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


async def _smoke_test() -> None:
    """Run as `poetry run python -m app.adapters.llm.openai_compatible`."""
    from app.adapters.factory import chat

    logging.basicConfig(level=logging.INFO)
    response = await chat.invoke(
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
