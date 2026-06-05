"""Protocol for a blob (object) storage provider.

Business / API code addresses objects by a stable *key* — a relative path such
as ``{learner_id}/{session_id}/{turn_id}_out.mp3`` — and never sees where the
bytes physically live. Swapping the backend (local disk, Qiniu, Aliyun OSS,
Tencent COS, Volcengine TOS, MinIO/S3) is a config change only: keys and all
callers stay identical.

V1 ships ``LocalBlobStorage`` (filesystem). Cloud backends implement the same
Protocol and return signed URLs from ``url()`` so the browser can fetch bytes
directly — to the rest of the service a backend is "an authenticated URL
prefix" plus put/get.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class BlobStorage(Protocol):
    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        """Store ``data`` under ``key``, overwriting any existing object."""
        ...

    async def get(self, key: str) -> bytes | None:
        """Return the object's bytes, or None if the key does not exist."""
        ...

    async def exists(self, key: str) -> bool: ...

    async def delete(self, key: str) -> None:
        """Remove the object. A no-op if the key is already absent."""
        ...

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        """A pre-authenticated URL the browser can fetch directly.

        Cloud backends return a time-limited signed URL. The local backend has
        no public origin and returns None — the caller then serves the bytes
        through its own authenticated endpoint instead.
        """
        ...
