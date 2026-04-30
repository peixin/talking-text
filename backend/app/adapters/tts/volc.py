"""Volcengine TTS adapter — V3 HTTP Chunked single-shot interface.

Endpoint: POST https://openspeech.bytedance.com/api/v3/tts/unidirectional

The wire protocol returns a stream of newline-delimited JSON objects:

    {"code": 0, "data": "<base64 audio chunk>"}
    {"code": 0, "data": null, "sentence": {...timestamps...}}
    {"code": 20000000, "message": "ok", "data": null, "usage": {"text_words": N}}

V1 (invoke) reads the whole stream, joins audio chunks, returns one blob. The
character count comes from the final ``usage.text_words`` field, which is what
Volcengine bills against (we ask for it via X-Control-Require-Usage-Tokens-Return).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from collections.abc import AsyncIterator

import httpx

from app.adapters.tts.protocol import TTSRequest, TTSResult
from app.config import settings

log = logging.getLogger(__name__)

_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
_DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class VolcTTSAdapter:
    def __init__(
        self,
        *,
        app_id: str | None = None,
        access_key: str | None = None,
        resource_id: str | None = None,
    ) -> None:
        self._app_id = app_id or settings.volc_speech_app_id
        self._access_key = access_key or settings.volc_speech_access_key
        self._resource_id = resource_id or settings.volc_tts_resource_id

    def _headers(self) -> dict[str, str]:
        # New-console auth uses X-Api-Key only; old-console uses App-Id + Access-Key.
        # The TTS V3 spec keeps both styles supported; we send the old-console pair
        # since that's what the speech console issues today.
        return {
            "X-Api-App-Id": self._app_id,
            "X-Api-Access-Key": self._access_key,
            "X-Api-Resource-Id": self._resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "X-Control-Require-Usage-Tokens-Return": "text_words",
            "Content-Type": "application/json",
        }

    def _payload(self, request: TTSRequest) -> dict:
        return {
            "user": {"uid": "talking-text"},
            "req_params": {
                "text": request.text,
                "speaker": request.voice,
                "audio_params": {
                    "format": request.audio_format,
                    "sample_rate": request.sample_rate,
                },
            },
        }

    async def invoke(self, request: TTSRequest) -> TTSResult:
        audio_chunks: list[bytes] = []
        chars = 0
        async with (
            httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client,
            client.stream(
                "POST",
                _TTS_URL,
                headers=self._headers(),
                json=self._payload(request),
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                msg = json.loads(line)
                code = msg.get("code", -1)
                data = msg.get("data")
                if data:
                    audio_chunks.append(base64.b64decode(data))
                if code == 20000000:
                    usage = msg.get("usage") or {}
                    chars = int(usage.get("text_words") or 0)
                    break
                if code not in (0, 20000000):
                    raise RuntimeError(
                        f"Volcengine TTS error code={code} message={msg.get('message')!r}"
                    )

        return TTSResult(
            audio=b"".join(audio_chunks),
            audio_format=request.audio_format,
            sample_rate=request.sample_rate,
            voice=request.voice,
            chars=chars or len(request.text),
        )

    def stream(self, request: TTSRequest) -> AsyncIterator[bytes]:
        raise NotImplementedError("V2: streaming will be wired through the WebSocket endpoint.")


async def _smoke_test() -> None:
    """Run as `poetry run python -m app.adapters.tts.volc`.

    Writes the synthesized audio to ``./tmp/tts_smoke.mp3`` so you can play it.
    """
    import pathlib

    logging.basicConfig(level=logging.INFO)
    adapter = VolcTTSAdapter()
    result = await adapter.invoke(
        TTSRequest(
            text="Hello! Today we are going to learn three new English words. Are you ready?",
            voice=settings.volc_tts_default_voice,
            audio_format=settings.volc_tts_audio_format,  # type: ignore[arg-type]
            sample_rate=settings.volc_tts_sample_rate,
        )
    )
    out = pathlib.Path("./tmp/tts_smoke.mp3")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(result.audio)
    print(f"voice:  {result.voice}")
    print(f"chars:  {result.chars}")
    print(f"bytes:  {len(result.audio)}")
    print(f"saved:  {out.resolve()}")


if __name__ == "__main__":
    asyncio.run(_smoke_test())
