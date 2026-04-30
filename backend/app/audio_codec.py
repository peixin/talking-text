"""Lightweight audio repackaging via ffmpeg.

Browser ``MediaRecorder`` produces ``audio/webm;codecs=opus`` by default.
Volcengine STT accepts ogg/opus, pcm, mp3, wav (and more) but explicitly does
not list webm. Re-muxing webm → ogg is the cheapest path: same opus codec,
no re-encoding, and the cost is a single ffmpeg subprocess (~30 ms locally).

If/when the input format is already accepted by STT, callers can skip this.
"""

from __future__ import annotations

import asyncio
import logging
import shutil

log = logging.getLogger(__name__)

_FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


async def webm_opus_to_ogg(webm_bytes: bytes, *, sample_rate: int = 16000) -> bytes:
    """Re-mux a webm/opus blob into an ogg/opus blob.

    Output is forced mono 16 kHz which is what Volcengine STT expects.
    Uses libopus to ensure the right ogg packetization even if the source
    container had a different frame size.
    """
    args = [
        _FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "webm",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "libopus",
        "-b:a",
        "24k",
        "-f",
        "ogg",
        "pipe:1",
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(webm_bytes)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (rc={proc.returncode}): {stderr.decode('utf-8', 'replace')}"
        )
    return stdout
