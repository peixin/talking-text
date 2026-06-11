"""Qiniu Kodo BlobStorage backend (async, plain httpx — no vendor SDK).

The bucket is shared by future content domains, so every instance namespaces
its keys under ``key_prefix`` (e.g. ``audio``) — the cloud twin of
LocalBlobStorage's ``root``. Callers and DB keys never see the prefix.

Direct-link readiness: ``url()`` returns a signed download URL only when the
bound domain is https:// (browser-usable from our HTTPS pages). While the
domain is http:// (free-tier CDN), ``url()`` returns None and the API endpoint
proxies bytes via ``get()`` — which always fetches server-side through the
same signed URL, where mixed content does not apply.

Switching vendors later (e.g. Volcengine TOS) = a sibling class implementing
the same Protocol + a factory case; keys stay identical.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import quote

import httpx

# Mainland regions: (upload host, rs/management host).
_REGION_HOSTS: dict[str, tuple[str, str]] = {
    "z0": ("https://up-z0.qiniup.com", "https://rs-z0.qiniuapi.com"),  # 华东-浙江
    "cn-east-2": ("https://up-cn-east-2.qiniup.com", "https://rs-cn-east-2.qiniuapi.com"),
    "z1": ("https://up-z1.qiniup.com", "https://rs-z1.qiniuapi.com"),  # 华北-河北
    "z2": ("https://up-z2.qiniup.com", "https://rs-z2.qiniuapi.com"),  # 华南-广东
}

# Qiniu's "no such file or directory" status (used by stat/delete and origin).
_STATUS_NOT_FOUND = (404, 612)


def _b64(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data)


class QiniuBlobStorage:
    """Private-bucket Kodo storage addressed through a bound (CDN) domain."""

    def __init__(
        self,
        *,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str,
        download_domain: str,
        key_prefix: str = "",
    ) -> None:
        if not (access_key and secret_key and bucket and download_domain):
            raise ValueError(
                "Qiniu backend needs QINIU_ACCESS_KEY / QINIU_SECRET_KEY / "
                "QINIU_BUCKET / QINIU_DOWNLOAD_DOMAIN — check .env"
            )
        try:
            self._up_host, self._rs_host = _REGION_HOSTS[region]
        except KeyError:
            raise ValueError(
                f"Unknown QINIU_REGION {region!r}; one of {sorted(_REGION_HOSTS)}"
            ) from None
        self._access_key = access_key
        self._secret_key = secret_key.encode()
        self._bucket = bucket
        self._domain = download_domain.rstrip("/")
        self._prefix = key_prefix.strip("/")
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))

    # ── BlobStorage protocol ─────────────────────────────────────────────────

    async def put(self, key: str, data: bytes, *, content_type: str) -> None:
        object_key = self._object_key(key)
        token = self._upload_token(object_key)
        resp = await self._client.post(
            self._up_host,
            data={"token": token, "key": object_key},
            files={"file": (object_key.rsplit("/", 1)[-1], data, content_type)},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Qiniu upload failed ({resp.status_code}): {resp.text}")

    async def get(self, key: str) -> bytes | None:
        resp = await self._client.get(self._signed_url(key, 3600))
        if resp.status_code in _STATUS_NOT_FOUND:
            return None
        if resp.status_code != 200:
            raise RuntimeError(f"Qiniu download failed ({resp.status_code}): {resp.text}")
        return resp.content

    async def exists(self, key: str) -> bool:
        resp = await self._rs("GET", f"/stat/{self._encoded_entry(key)}")
        if resp.status_code == 200:
            return True
        if resp.status_code in _STATUS_NOT_FOUND:
            return False
        raise RuntimeError(f"Qiniu stat failed ({resp.status_code}): {resp.text}")

    async def delete(self, key: str) -> None:
        resp = await self._rs("POST", f"/delete/{self._encoded_entry(key)}")
        if resp.status_code not in (200, *_STATUS_NOT_FOUND):
            raise RuntimeError(f"Qiniu delete failed ({resp.status_code}): {resp.text}")

    async def url(self, key: str, *, expires: int = 3600) -> str | None:
        # http:// domain is unusable from an HTTPS page (mixed content) — the
        # caller must proxy. Bind an https:// domain to flip on direct links.
        if not self._domain.startswith("https://"):
            return None
        return self._signed_url(key, expires)

    # ── Qiniu wire format ────────────────────────────────────────────────────

    def _object_key(self, key: str) -> str:
        return f"{self._prefix}/{key}" if self._prefix else key

    def _encoded_entry(self, key: str) -> str:
        return _b64(f"{self._bucket}:{self._object_key(key)}".encode()).decode()

    def _sign(self, data: bytes) -> str:
        return _b64(hmac.new(self._secret_key, data, hashlib.sha1).digest()).decode()

    def _upload_token(self, object_key: str) -> str:
        # scope "bucket:key" also permits overwrite, matching put() semantics.
        policy = _b64(
            json.dumps(
                {"scope": f"{self._bucket}:{object_key}", "deadline": int(time.time()) + 3600}
            ).encode()
        )
        return f"{self._access_key}:{self._sign(policy)}:{policy.decode()}"

    def _signed_url(self, key: str, expires: int) -> str:
        deadline = int(time.time()) + expires
        bare = f"{self._domain}/{quote(self._object_key(key), safe='/')}?e={deadline}"
        return f"{bare}&token={self._access_key}:{self._sign(bare.encode())}"

    async def _rs(self, method: str, path: str) -> httpx.Response:
        # QBox management auth: sign "<path>\n" (+ urlencoded body, empty here).
        token = f"QBox {self._access_key}:{self._sign(f'{path}\n'.encode())}"
        return await self._client.request(
            method,
            f"{self._rs_host}{path}",
            headers={
                "Authorization": token,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
