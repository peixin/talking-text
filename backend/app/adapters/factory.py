"""Adapter factory — reads app_config.adapter and returns the right implementation.

Module-level singletons are created once at startup and shared across all
routers. Each adapter is a stateless async wrapper, so sharing is safe.

To add a new provider (e.g. DeepSeek for LLM):
  1. Add the adapter in app/adapters/llm/deepseek.py
  2. Add a case to _make_llm() below
  3. Set llm_provider = "deepseek" in config.toml
"""

from __future__ import annotations

from app.adapters.llm.protocol import LLMAdapter
from app.adapters.storage.protocol import BlobStorage
from app.adapters.stt.protocol import STTAdapter
from app.adapters.tts.protocol import TTSAdapter
from app.app_config import app_config
from app.core.dialog import DialogOrchestrator
from app.core.scope import V1ScopeComputer


def _make_llm() -> LLMAdapter:
    match app_config.adapter.llm_provider:
        case "deepseek":
            from app.adapters.llm.deepseek import DeepSeekLLMAdapter

            return DeepSeekLLMAdapter()
        case "volc_ark":
            from app.adapters.llm.volc import VolcLLMAdapter

            return VolcLLMAdapter(model=app_config.adapter.llm.model or None)
        case other:
            raise ValueError(f"Unknown LLM provider: {other!r}")


def _make_vision() -> LLMAdapter:
    match app_config.adapter.vision_provider:
        case "volc_ark":
            from app.adapters.llm.volc import VolcLLMAdapter
            from app.config import settings

            vision_model = settings.volc_ark_vision_model or app_config.adapter.vision.model or None
            return VolcLLMAdapter(vision_model=vision_model)
        case other:
            raise ValueError(f"Unknown vision provider: {other!r}")


def _make_stt() -> STTAdapter:
    match app_config.adapter.stt_provider:
        case "volc":
            from app.adapters.stt.volc import VolcSTTAdapter

            return VolcSTTAdapter()
        case other:
            raise ValueError(f"Unknown STT provider: {other!r}")


def _make_tts() -> TTSAdapter:
    match app_config.adapter.tts_provider:
        case "volc":
            from app.adapters.tts.volc import VolcTTSAdapter

            return VolcTTSAdapter()
        case other:
            raise ValueError(f"Unknown TTS provider: {other!r}")


def _make_blob() -> BlobStorage:
    """Pick the blob backend. Local disk for V1; a cloud provider switch
    (Qiniu / Aliyun / Tencent / Volcengine TOS / MinIO) lands here later."""
    from app.config import settings

    if not settings.audio_storage_enabled:
        from app.adapters.storage.local import NullBlobStorage

        return NullBlobStorage()

    from app.adapters.storage.local import LocalBlobStorage

    return LocalBlobStorage(root=settings.audio_storage_dir)


# ── Shared singletons ────────────────────────────────────────────────────────

llm: LLMAdapter = _make_llm()
vision: LLMAdapter = _make_vision()
stt: STTAdapter = _make_stt()
tts: TTSAdapter = _make_tts()
blob: BlobStorage = _make_blob()
orchestrator: DialogOrchestrator = DialogOrchestrator(
    stt=stt, llm=llm, tts=tts, scope=V1ScopeComputer(), blob=blob
)
