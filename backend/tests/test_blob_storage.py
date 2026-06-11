"""TieredBlobStorage lifecycle + QiniuBlobStorage key/url shape (no network)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from app.adapters.storage.local import LocalBlobStorage
from app.adapters.storage.qiniu import QiniuBlobStorage
from app.adapters.storage.tiered import TieredBlobStorage


class FakeRemote:
    """In-memory BlobStorage standing in for a cloud backend."""

    def __init__(self, *, fail_puts: bool = False) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_puts = fail_puts

    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        if self.fail_puts:
            raise RuntimeError("simulated upload failure")
        self.objects[key] = data

    async def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    async def exists(self, key: str) -> bool:
        return key in self.objects

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        return f"https://remote.example/{key}?signed=1"


async def _settle(tiered: TieredBlobStorage) -> None:
    """Wait for in-flight background replications."""
    while tiered._uploads:
        await asyncio.gather(*tiered._uploads, return_exceptions=True)


@pytest.fixture
def cache(tmp_path: Path) -> LocalBlobStorage:
    return LocalBlobStorage(root=str(tmp_path))


KEY = "learner/session/turn_out.mp3"


async def test_put_replicates_then_drops_local(cache: LocalBlobStorage) -> None:
    remote = FakeRemote()
    tiered = TieredBlobStorage(cache=cache, remote=remote)

    await tiered.put(KEY, b"audio-bytes", content_type="audio/mpeg")
    await _settle(tiered)

    assert remote.objects[KEY] == b"audio-bytes"
    assert not await cache.exists(KEY)  # staged copy removed after upload
    assert await tiered.get(KEY) == b"audio-bytes"  # served from remote


async def test_failed_upload_keeps_local_and_never_404s(cache: LocalBlobStorage) -> None:
    remote = FakeRemote(fail_puts=True)
    tiered = TieredBlobStorage(cache=cache, remote=remote)

    await tiered.put(KEY, b"audio-bytes", content_type="audio/mpeg")
    await _settle(tiered)

    assert await cache.exists(KEY)  # kept for retry
    assert await tiered.get(KEY) == b"audio-bytes"  # still readable
    assert await tiered.url(KEY) is None  # remote URL would 404 -> proxy locally

    remote.fail_puts = False
    await tiered.sync_pending()  # startup recovery path

    assert remote.objects[KEY] == b"audio-bytes"
    assert not await cache.exists(KEY)
    assert await tiered.url(KEY) == f"https://remote.example/{KEY}?signed=1"


def _qiniu(domain: str) -> QiniuBlobStorage:
    return QiniuBlobStorage(
        access_key="AK",
        secret_key="SK",
        bucket="bkt",
        region="z0",
        download_domain=domain,
        key_prefix="audio",
    )


def test_qiniu_key_prefix_namespaces_the_shared_bucket() -> None:
    assert _qiniu("http://blob.example")._object_key(KEY) == f"audio/{KEY}"


async def test_qiniu_url_gated_on_https_domain() -> None:
    # http:// CDN domain is mixed content from our HTTPS pages -> caller proxies.
    assert await _qiniu("http://blob.example").url(KEY) is None

    signed = await _qiniu("https://blob.example").url(KEY)
    assert signed is not None
    parsed = urlparse(signed)
    query = parse_qs(parsed.query)
    assert parsed.path == f"/audio/{KEY}"
    assert query["e"][0].isdigit()  # deadline
    assert query["token"][0].startswith("AK:")  # access key : signature
