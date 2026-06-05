"""Adapter factory — reads app_config.adapter and returns the right implementation.

Module-level singletons are created once at startup and shared across all
routers. Each adapter is a stateless async wrapper, so sharing is safe.

All LLM providers share one OpenAI-compatible class, so adding a provider
(e.g. Aliyun / Tencent / Xiaomi) is config + a case in _openai_llm():
  1. Add its secret(s) to .env + Settings (+ .env.example)
  2. Add a case to _openai_llm() mapping name -> base_url / key / knobs
  3. Add [adapter.llm.<name>] in config.toml and point a role at it
"""

from __future__ import annotations

from app.adapters.llm.openai_compatible import OpenAICompatibleLLMAdapter
from app.adapters.llm.protocol import Modality, MultimodalLLM, TextLLM
from app.adapters.storage.protocol import BlobStorage
from app.adapters.stt.protocol import STTAdapter
from app.adapters.tts.protocol import TTSAdapter
from app.app_config import app_config
from app.core.dialog import DialogOrchestrator
from app.core.scope import V1ScopeComputer

# Providers whose configured models can accept image input (for the extraction
# role). Text-only providers (e.g. deepseek) must not be wired here.
_VISION_CAPABLE_PROVIDERS = frozenset({"volc_ark"})


def _openai_llm(
    provider: str, model: str, modalities: frozenset[Modality]
) -> OpenAICompatibleLLMAdapter:
    """Build an OpenAI-compatible adapter for a named provider + model."""
    from app.config import settings

    match provider:
        case "deepseek":
            cfg = app_config.adapter.llm
            thinking_on = cfg.thinking == "enabled"
            return OpenAICompatibleLLMAdapter(
                api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url,
                model=model,
                modalities=modalities,
                extra_body={"thinking": {"type": cfg.thinking}},
                reasoning_effort=cfg.reasoning_effort if thinking_on else None,
            )
        case "volc_ark":
            return OpenAICompatibleLLMAdapter(
                api_key=settings.volc_ark_api_key,
                base_url=settings.volc_ark_base_url,
                model=model,
                modalities=modalities,
            )
        case other:
            raise ValueError(f"Unknown OpenAI-compatible LLM provider: {other!r}")


def _make_llm() -> TextLLM:
    """Chat role — text in, text out."""
    return _openai_llm(
        app_config.adapter.llm_provider, app_config.adapter.llm.model, frozenset({"text"})
    )


def _make_extraction() -> MultimodalLLM:
    """Extraction role — text + image in (curriculum OCR / structured extraction)."""
    from app.config import settings

    provider = app_config.adapter.vision_provider
    if provider not in _VISION_CAPABLE_PROVIDERS:
        raise ValueError(
            f"vision_provider {provider!r} does not support image input; "
            f"pick one of {sorted(_VISION_CAPABLE_PROVIDERS)}"
        )
    model = settings.volc_ark_vision_model or app_config.adapter.vision.model
    return _openai_llm(provider, model, frozenset({"text", "image"}))


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

llm: TextLLM = _make_llm()
extraction: MultimodalLLM = _make_extraction()
stt: STTAdapter = _make_stt()
tts: TTSAdapter = _make_tts()
blob: BlobStorage = _make_blob()
orchestrator: DialogOrchestrator = DialogOrchestrator(
    stt=stt, llm=llm, tts=tts, scope=V1ScopeComputer(), blob=blob
)
