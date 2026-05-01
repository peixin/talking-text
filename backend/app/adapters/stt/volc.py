"""Volcengine STT adapter — V3 streaming-input WebSocket.

Endpoint: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream

The streaming-input mode lets us send the entire audio as a sequence of small
packets and get one accurate transcription back at the end. For short
utterances (≤ 15 s) the result is returned within ~300-400 ms after the last
chunk lands. From our caller's perspective this is a synchronous request.

Wire protocol (custom binary; see Volcengine docs §"WebSocket binary protocol"):

    Byte 0 — protocol version (0x1) | header size (0x1)
    Byte 1 — message type (4 bits) | message-type flags (4 bits)
    Byte 2 — serialization (4 bits) | compression (4 bits)
    Byte 3 — reserved (0x00)
    Bytes [4..7] — sequence number (big-endian int32, when flags say so)
    Bytes [8..11] — payload size (big-endian uint32)
    Bytes [12..]  — payload

The first request is a JSON ``full client request`` carrying parameters; then
audio is sent as raw chunks (``audio only request``); the last audio packet
sets the negative-sequence flag to signal end-of-stream.

Response packets share the same framing. The server sends one ``full server
response`` per packet we send; we ignore intermediate ones and pick up the
final result on the negative-sequence response.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import struct
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import websockets

from app.adapters.stt.protocol import AudioFormat, STTRequest, STTResult
from app.config import settings

log = logging.getLogger(__name__)

_STT_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream"

# Header bits.
_PROTOCOL_VERSION = 0b0001
_HEADER_SIZE_4B = 0b0001

_MSG_FULL_CLIENT = 0b0001
_MSG_AUDIO_ONLY = 0b0010
_MSG_FULL_SERVER = 0b1001
_MSG_ERROR = 0b1111

_FLAG_NONE = 0b0000
_FLAG_POS_SEQ = 0b0001  # header has positive sequence number
_FLAG_NEG_SEQ_NO_NUM = 0b0010  # last packet, no sequence number
_FLAG_NEG_SEQ = 0b0011  # last packet with negative sequence number

_SER_NONE = 0b0000
_SER_JSON = 0b0001

_COMP_NONE = 0b0000
_COMP_GZIP = 0b0001

# Packet size knobs. ~200 ms per packet at 16 kHz mono int16 = 6400 bytes.
_AUDIO_CHUNK_BYTES = 6400
_AUDIO_PACKET_INTERVAL_S = 0.05  # token-bucket pacing; the server expects steady arrival


@dataclass
class _Frame:
    msg_type: int
    flags: int
    sequence: int | None
    payload: bytes


def _pack_header(msg_type: int, flags: int, serialization: int, compression: int) -> bytes:
    return bytes(
        [
            (_PROTOCOL_VERSION << 4) | _HEADER_SIZE_4B,
            (msg_type << 4) | flags,
            (serialization << 4) | compression,
            0x00,
        ]
    )


def _pack_request(
    *,
    msg_type: int,
    flags: int,
    sequence: int | None,
    payload: bytes,
    serialization: int,
    compression: int,
) -> bytes:
    body = _pack_header(msg_type, flags, serialization, compression)
    if sequence is not None:
        body += struct.pack(">i", sequence)  # signed int32, big-endian
    if compression == _COMP_GZIP:
        payload = gzip.compress(payload)
    body += struct.pack(">I", len(payload)) + payload
    return body


def _parse_response(data: bytes) -> _Frame:
    if len(data) < 4:
        raise RuntimeError(f"STT frame too short: {len(data)} bytes")
    header_b1, header_b2, header_b3, _ = data[0], data[1], data[2], data[3]
    header_size_words = header_b1 & 0x0F
    msg_type = (header_b2 >> 4) & 0x0F
    flags = header_b2 & 0x0F
    compression = header_b3 & 0x0F
    offset = header_size_words * 4

    sequence: int | None = None
    if flags in (_FLAG_POS_SEQ, _FLAG_NEG_SEQ):
        sequence = struct.unpack(">i", data[offset : offset + 4])[0]
        offset += 4

    if msg_type == _MSG_ERROR:
        # error code (4 bytes) then message size (4 bytes) then utf-8 message
        error_code = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        msg_size = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        payload = data[offset : offset + msg_size]
        if compression == _COMP_GZIP:
            payload = gzip.decompress(payload)
        msg = payload.decode("utf-8", "replace")
        raise RuntimeError(f"STT server error code={error_code}: {msg}")

    payload_size = struct.unpack(">I", data[offset : offset + 4])[0]
    offset += 4
    payload = data[offset : offset + payload_size]
    if compression == _COMP_GZIP:
        payload = gzip.decompress(payload)
    return _Frame(msg_type=msg_type, flags=flags, sequence=sequence, payload=payload)


def _language_for(language: str | None) -> str | None:
    """Map our internal hints to Volcengine `audio.language` strings."""
    # Empty / None lets the model auto-detect zh + en + dialects (the default
    # we want for the kid-and-parent bilingual chat).
    return language


class VolcSTTAdapter:
    def __init__(
        self,
        *,
        app_id: str | None = None,
        access_key: str | None = None,
        resource_id: str | None = None,
        model_name: str | None = None,
        sample_rate: int | None = None,
    ) -> None:
        self._app_id = app_id or settings.volc_speech_app_id
        self._access_key = access_key or settings.volc_speech_access_key
        self._resource_id = resource_id or settings.volc_stt_resource_id
        self._model_name = model_name or settings.volc_stt_model_name
        self._sample_rate = sample_rate or settings.volc_stt_sample_rate

    def _headers(self) -> dict[str, str]:
        return {
            "X-Api-App-Key": self._app_id,
            "X-Api-Access-Key": self._access_key,
            "X-Api-Resource-Id": self._resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }

    def _initial_payload(self, request: STTRequest) -> bytes:
        audio: dict[str, object] = {
            "format": request.audio_format,
            "rate": request.sample_rate,
            "bits": 16,
            "channel": 1,
            "codec": "opus" if request.audio_format == "ogg" else "raw",
        }
        if request.language:
            audio["language"] = request.language
        body = {
            "user": {"uid": "talking-text"},
            "audio": audio,
            "request": {
                "model_name": self._model_name,
                "enable_itn": True,
                "enable_punc": True,
                "show_utterances": True,
            },
        }
        return json.dumps(body, ensure_ascii=False).encode("utf-8")

    async def invoke(self, request: STTRequest) -> STTResult:
        seq = 1
        async with websockets.connect(
            _STT_URL,
            additional_headers=self._headers(),
            max_size=2**24,
        ) as ws:
            # 1) full client request — params, with positive seq
            await ws.send(
                _pack_request(
                    msg_type=_MSG_FULL_CLIENT,
                    flags=_FLAG_POS_SEQ,
                    sequence=seq,
                    payload=self._initial_payload(request),
                    serialization=_SER_JSON,
                    compression=_COMP_GZIP,
                )
            )
            await _expect_ack(ws)

            # 2) audio packets with positive seq, then a final negative-seq close
            audio = request.audio
            offset = 0
            while True:
                seq += 1
                chunk = audio[offset : offset + _AUDIO_CHUNK_BYTES]
                offset += _AUDIO_CHUNK_BYTES
                is_last = offset >= len(audio)
                flags = _FLAG_NEG_SEQ if is_last else _FLAG_POS_SEQ
                sequence = -seq if is_last else seq
                await ws.send(
                    _pack_request(
                        msg_type=_MSG_AUDIO_ONLY,
                        flags=flags,
                        sequence=sequence,
                        payload=chunk,
                        serialization=_SER_NONE,
                        compression=_COMP_GZIP,
                    )
                )
                if is_last:
                    break
                # Light pacing so we don't blow the server's input buffer.
                await asyncio.sleep(_AUDIO_PACKET_INTERVAL_S)

            # 3) read until we see the final response frame (matches our last seq)
            final_payload: dict | None = None
            while True:
                raw = await ws.recv()
                if isinstance(raw, str):
                    log.warning("STT received unexpected text frame: %s", raw)
                    continue
                frame = _parse_response(raw)
                if not frame.payload:
                    continue
                try:
                    body = json.loads(frame.payload)
                except json.JSONDecodeError:
                    continue
                final_payload = body
                # The final frame has flag _FLAG_NEG_SEQ (last packet); break on it.
                if frame.flags == _FLAG_NEG_SEQ:
                    break

        if final_payload is None:
            raise RuntimeError("STT closed before any result was returned")

        result = final_payload.get("result", {}) or {}
        text = result.get("text", "") or ""
        audio_info = final_payload.get("audio_info", {}) or {}
        duration_ms = float(audio_info.get("duration") or 0)

        return STTResult(
            text=text,
            audio_seconds=duration_ms / 1000.0,
            raw=final_payload,
        )

    def stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        *,
        audio_format: AudioFormat,
        sample_rate: int,
    ) -> AsyncIterator[STTResult]:
        raise NotImplementedError("V2: real streaming will reuse the same WS, no batching.")


async def _expect_ack(ws: websockets.ClientConnection) -> None:
    raw = await ws.recv()
    if isinstance(raw, str):
        raise RuntimeError(f"STT handshake returned text instead of binary: {raw}")
    frame = _parse_response(raw)
    if frame.msg_type == _MSG_ERROR:
        raise RuntimeError(f"STT init failed: {frame.payload!r}")


async def _smoke_test() -> None:
    """Run as `poetry run python -m app.adapters.stt.volc <path-to-ogg-or-mp3>`.

    Reads a local file (ogg/opus or mp3) and prints the transcription.
    Use ffmpeg to make a sample:
        ffmpeg -f lavfi -t 3 -i sine=f=440 -ac 1 -ar 16000 -c:a libopus tmp/test.ogg
    Or record one yourself in the browser and copy it out of the network panel.
    """
    import pathlib
    import sys

    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print("usage: python -m app.adapters.stt.volc <audio-file>")
        return
    path = pathlib.Path(sys.argv[1])
    audio = path.read_bytes()
    fmt: AudioFormat
    suffix = path.suffix.lower()
    if suffix in (".ogg", ".opus"):
        fmt = "ogg"
    elif suffix == ".mp3":
        fmt = "mp3"
    elif suffix == ".wav":
        fmt = "wav"
    else:
        fmt = "pcm"

    adapter = VolcSTTAdapter()
    result = await adapter.invoke(STTRequest(audio=audio, audio_format=fmt, sample_rate=16000))
    print(f"seconds:  {result.audio_seconds:.2f}")
    print(f"text:     {result.text!r}")


if __name__ == "__main__":
    asyncio.run(_smoke_test())
