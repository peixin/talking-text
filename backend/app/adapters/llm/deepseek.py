"""DeepSeek LLM adapter (OpenAI-compatible endpoint).

Thinking mode and reasoning effort are controlled via config.toml
[adapter.llm.deepseek]. For child-chat turns, thinking should be
disabled to avoid the chain-of-thought latency overhead.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterator

from openai import AsyncOpenAI

from app.adapters.llm.protocol import LLMMessage, LLMResponse
from app.app_config import app_config
from app.config import settings

log = logging.getLogger(__name__)

_BASE_URL = "https://api.deepseek.com"


class DeepSeekLLMAdapter:
    def __init__(self) -> None:
        cfg = app_config.adapter.llm
        self._model = cfg.model
        self._thinking = cfg.thinking  # "disabled" | "enabled"
        self._reasoning_effort = cfg.reasoning_effort
        self._client = AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url=_BASE_URL,
        )

    async def invoke(
        self,
        messages: list[LLMMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        extra: dict = {"thinking": {"type": self._thinking}}
        kwargs: dict = dict(
            model=self._model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=extra,
        )
        if self._thinking == "enabled":
            kwargs["reasoning_effort"] = self._reasoning_effort

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
    ) -> AsyncGenerator[str, None]:
        extra: dict = {"thinking": {"type": self._thinking}}
        kwargs: dict = dict(
            model=self._model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            extra_body=extra,
        )
        if self._thinking == "enabled":
            kwargs["reasoning_effort"] = self._reasoning_effort

        response = await self._client.chat.completions.create(**kwargs)
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


async def _smoke_test() -> None:
    """Run as `poetry run python -m app.adapters.llm.deepseek`."""
    logging.basicConfig(level=logging.INFO)
    adapter = DeepSeekLLMAdapter()
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
