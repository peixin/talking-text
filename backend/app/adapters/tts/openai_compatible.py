"""TTS adapter for any OpenAI-compatible ``/audio/speech`` endpoint.

Works with OpenAI itself and any drop-in compatible server (e.g. a self-hosted
Qwen3-TTS via tts-router). Note: as of 2026-06, the mainland Chinese vendors do
NOT expose this standard endpoint — Aliyun Qwen-TTS is DashScope-native
(WebSocket) and Xiaomi's audio API shape is unpublished — so each of those would
need its own bespoke adapter. This is the standard, vendor-neutral seam.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import httpx

from app.adapters.tts.protocol import TTSRequest, TTSResult
from app.config import settings

log = logging.getLogger(__name__)

# Our internal formats -> OpenAI /audio/speech response_format values.
_RESPONSE_FORMAT = {"mp3": "mp3", "ogg_opus": "opus", "pcm": "pcm"}


class OpenAITTSAdapter:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self._api_key = api_key or settings.openai_tts_api_key
        self._base_url = (base_url or settings.openai_tts_base_url).rstrip("/")
        self._model = model or settings.openai_tts_model

    async def invoke(self, request: TTSRequest) -> TTSResult:
        body = {
            "model": self._model,
            "input": request.text,
            "voice": request.voice,
            "response_format": _RESPONSE_FORMAT.get(request.audio_format, "mp3"),
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self._base_url}/audio/speech",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            audio = resp.content

        return TTSResult(
            audio=audio,
            audio_format=request.audio_format,
            sample_rate=request.sample_rate,
            voice=request.voice,
            chars=len(request.text),  # /audio/speech returns no usage; estimate by length
        )

    def stream(self, request: TTSRequest) -> AsyncIterator[bytes]:
        raise NotImplementedError("V2: streaming TTS not wired for the OpenAI endpoint yet.")
