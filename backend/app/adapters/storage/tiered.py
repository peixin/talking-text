"""Tiered BlobStorage: local staging in front of a cloud backend.

Writes land on local disk first (the turn responds immediately), then a
background task replicates to the remote and deletes the local copy once the
remote confirms it. Reads prefer local — in-flight conversations never touch
the cloud and can never 404, because ``get()`` falls back to the remote after
the local copy is gone.

A failed upload leaves the local copy in place; ``sync_pending()`` (run at
startup) re-replicates whatever is still staged locally.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes

from app.adapters.storage.local import LocalBlobStorage
from app.adapters.storage.protocol import BlobStorage

log = logging.getLogger(__name__)


class TieredBlobStorage:
    """Local write-back cache over a remote BlobStorage."""

    def __init__(self, *, cache: LocalBlobStorage, remote: BlobStorage) -> None:
        self._cache = cache
        self._remote = remote
        self._uploads: set[asyncio.Task[None]] = set()

    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        await self._cache.put(key, data, content_type=content_type)
        task = asyncio.create_task(self._replicate(key, data, content_type))
        self._uploads.add(task)
        task.add_done_callback(self._uploads.discard)

    async def get(self, key: str) -> bytes | None:
        data = await self._cache.get(key)
        if data is not None:
            return data
        return await self._remote.get(key)

    async def exists(self, key: str) -> bool:
        return await self._cache.exists(key) or await self._remote.exists(key)

    async def delete(self, key: str) -> None:
        await self._cache.delete(key)
        await self._remote.delete(key)

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        # While the object is still staged locally (upload pending), a remote
        # URL would 404 — serve through our own endpoint instead.
        if await self._cache.exists(key):
            return None
        return await self._remote.url(key, expires=expires)

    async def sync_pending(self) -> None:
        """Replicate everything still staged locally (startup crash recovery)."""
        for key in self._cache.iter_keys():
            data = await self._cache.get(key)
            if data is None:  # raced with a concurrent replicate
                continue
            content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
            await self._replicate(key, data, content_type)

    async def _replicate(self, key: str, data: bytes, content_type: str) -> None:
        try:
            await self._remote.put(key, data, content_type=content_type)
            if await self._remote.exists(key):
                await self._cache.delete(key)
            else:
                log.error("blob replicate: remote has no %r after put; keeping local", key)
        except Exception:
            # Local copy stays; sync_pending() retries at next startup.
            log.exception("blob replicate failed for %r; keeping local copy", key)
