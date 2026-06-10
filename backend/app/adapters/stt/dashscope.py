"""Aliyun DashScope (Bailian) Qwen-ASR adapter.

Qwen3-ASR is NOT the standard OpenAI ``/audio/transcriptions`` endpoint — it
rides on the OpenAI-compatible ``/chat/completions`` endpoint with the audio as
an ``input_audio`` content part, and a top-level ``asr_options`` field for
language control. Transcription comes back in ``message.content``.

Strength for us: native Chinese+English code-switching (omit ``language`` for
multilingual), which fits kids who drop Chinese into English speech.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import AsyncIterator

import httpx

from app.adapters.stt.protocol import AudioFormat, STTRequest, STTResult
from app.config import settings

log = logging.getLogger(__name__)

# Our internal formats -> data-URL media types Qwen-ASR understands.
_MIME = {"mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "pcm": "audio/wav"}
# Our internal formats -> the required input_audio "format" value. Keep this
# consistent with _MIME: raw pcm is labeled wav there, so it is labeled wav here too.
_FORMAT = {"mp3": "mp3", "wav": "wav", "ogg": "ogg", "pcm": "wav"}


class DashScopeQwenASRAdapter:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self._api_key = api_key or settings.dashscope_api_key
        self._base_url = (base_url or settings.dashscope_base_url).rstrip("/")
        self._model = model or settings.dashscope_asr_model

    async def invoke(self, request: STTRequest) -> STTResult:
        mime = _MIME.get(request.audio_format, "audio/wav")
        b64 = base64.b64encode(request.audio).decode("ascii")
        data_url = f"data:{mime};base64,{b64}"

        # DashScope Qwen-ASR / OpenAI chat completions API requires the "format" parameter.
        fmt = _FORMAT.get(request.audio_format, "wav")

        body: dict = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": data_url,
                                "format": fmt,
                            },
                        }
                    ],
                }
            ],
        }
        # Omit asr_options.language entirely for multilingual (zh+en) auto-detect.
        if request.language:
            body["asr_options"] = {"language": request.language}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()

        try:
            text = (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"Unexpected Qwen-ASR response shape: {data!r}") from e

        # Qwen-ASR is token-billed, not per-second: audio_seconds stays 0 and the
        # cost signal is the usage token counts instead.
        usage = data.get("usage") or {}
        return STTResult(
            text=text,
            audio_seconds=0.0,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            raw=data,
        )

    def stream(
        self, audio_chunks: AsyncIterator[bytes], *, audio_format: AudioFormat, sample_rate: int
    ) -> AsyncIterator[STTResult]:
        raise NotImplementedError("V2: streaming ASR not wired for DashScope yet.")
