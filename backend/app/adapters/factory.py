"""Adapter factory — reads app_config.adapter and returns the right implementation.

Module-level singletons are created once at startup and shared across all
routers. Each adapter is a stateless async wrapper, so sharing is safe.

All LLM providers share one OpenAI-compatible class, so adding a provider
(e.g. Tencent) is config + a case in _openai_llm():
  1. Add its secret(s) to .env + Settings (+ .env.example)
  2. Add a case to _openai_llm() mapping name -> base_url / key / knobs
  3. Point a stage at it in config.toml [adapter.stage.*]
"""

from __future__ import annotations

from app.adapters.llm.openai_compatible import OpenAICompatibleLLMAdapter
from app.adapters.llm.protocol import Modality, MultimodalLLM, TextLLM
from app.adapters.storage.protocol import BlobStorage
from app.adapters.stt.protocol import STTAdapter
from app.adapters.tts.protocol import TTSAdapter
from app.app_config import StageConfig, app_config
from app.core.dialog import DialogOrchestrator
from app.core.scope import V1ScopeComputer

# Providers whose models can accept image input (for the extraction stage).
# Text-only providers (e.g. deepseek) must not be wired to a multimodal stage.
_VISION_CAPABLE_PROVIDERS = frozenset({"volc_ark", "aliyun", "xiaomi"})


def _openai_llm(
    stage: StageConfig, model: str, modalities: frozenset[Modality]
) -> OpenAICompatibleLLMAdapter:
    """Build an OpenAI-compatible adapter for a stage's provider + model."""
    from app.config import settings

    match stage.provider:
        case "deepseek":
            thinking_on = stage.thinking == "enabled"
            return OpenAICompatibleLLMAdapter(
                api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url,
                model=model,
                modalities=modalities,
                extra_body={"thinking": {"type": stage.thinking}},
                reasoning_effort=stage.reasoning_effort if thinking_on else None,
            )
        case "volc_ark":
            return OpenAICompatibleLLMAdapter(
                api_key=settings.volc_ark_api_key,
                base_url=settings.volc_ark_base_url,
                model=model,
                modalities=modalities,
            )
        case "aliyun":
            return OpenAICompatibleLLMAdapter(
                api_key=settings.dashscope_api_key,
                base_url=settings.dashscope_base_url,
                model=model,
                modalities=modalities,
            )
        case "xiaomi":
            return OpenAICompatibleLLMAdapter(
                api_key=settings.xiaomi_api_key,
                base_url=settings.xiaomi_base_url,
                model=model,
                modalities=modalities,
            )
        case other:
            raise ValueError(f"Unknown OpenAI-compatible LLM provider: {other!r}")


def _make_chat() -> TextLLM:
    """Chat stage — text in, text out (dialog + utility tasks)."""
    stage = app_config.adapter.chat
    return _openai_llm(stage, stage.model, frozenset({"text"}))


def _make_multimodal(stage: StageConfig, role: str) -> MultimodalLLM:
    """Build a vision-capable adapter for a stage (extraction / perception)."""
    from app.config import settings

    if stage.provider not in _VISION_CAPABLE_PROVIDERS:
        raise ValueError(
            f"{role} provider {stage.provider!r} does not support image input; "
            f"pick one of {sorted(_VISION_CAPABLE_PROVIDERS)}"
        )
    # volc_ark's vision endpoint id lives in .env; other providers use the config model.
    model = stage.model
    if stage.provider == "volc_ark":
        model = settings.volc_ark_vision_model or stage.model
    return _openai_llm(stage, model, frozenset({"text", "image"}))


def _make_extraction() -> MultimodalLLM:
    """Single-shot extraction stage — OCR + structuring in one multimodal call."""
    return _make_multimodal(app_config.adapter.extraction, "extraction")


def _make_perception() -> MultimodalLLM:
    """Two-stage perception — VLM layout-aware transcription of material images."""
    return _make_multimodal(app_config.adapter.perception, "perception")


def _make_structuring() -> TextLLM:
    """Two-stage structuring — text 'brain' that turns transcription into items."""
    stage = app_config.adapter.structuring
    return _openai_llm(stage, stage.model, frozenset({"text"}))


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

chat: TextLLM = _make_chat()
extraction: MultimodalLLM = _make_extraction()  # single-shot mode
perception: MultimodalLLM = _make_perception()  # two_stage: image -> transcription
structuring: TextLLM = _make_structuring()  # two_stage: text -> items
stt: STTAdapter = _make_stt()
tts: TTSAdapter = _make_tts()
blob: BlobStorage = _make_blob()
orchestrator: DialogOrchestrator = DialogOrchestrator(
    stt=stt, llm=chat, tts=tts, scope=V1ScopeComputer(), blob=blob
)
