"""Filesystem-backed BlobStorage + a no-op backend for disabled storage.

The configured root is an implementation detail: it never appears in keys, so
migrating to a cloud backend later is just copying the files — no key rewrite.
"""

from __future__ import annotations

from pathlib import Path


class LocalBlobStorage:
    """Stores objects on the local filesystem under ``root``."""

    def __init__(self, root: str) -> None:
        self._root = Path(root)

    def _resolve(self, key: str) -> Path:
        """Map a key to an absolute path, rejecting traversal outside root."""
        target = (self._root / key).resolve()
        root = self._root.resolve()
        if target != root and root not in target.parents:
            raise ValueError(f"Unsafe storage key: {key!r}")
        return target

    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        target = self._resolve(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    async def get(self, key: str) -> bytes | None:
        target = self._resolve(key)
        if not target.exists():
            return None
        return target.read_bytes()

    async def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    async def delete(self, key: str) -> None:
        self._resolve(key).unlink(missing_ok=True)

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        return None  # no public origin — caller serves via its own endpoint


class NullBlobStorage:
    """No-op backend used when audio persistence is disabled."""

    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        return None

    async def get(self, key: str) -> bytes | None:
        return None

    async def exists(self, key: str) -> bool:
        return False

    async def delete(self, key: str) -> None:
        return None

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        return None
