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
from app.adapters.stt.protocol import STTAdapter
from app.adapters.tts.protocol import TTSAdapter
from app.app_config import app_config
from app.core.dialog import DialogOrchestrator


def _make_llm() -> LLMAdapter:
    match app_config.adapter.llm_provider:
        case "volc_ark":
            from app.adapters.llm.volc import VolcLLMAdapter

            return VolcLLMAdapter()
        case other:
            raise ValueError(f"Unknown LLM provider: {other!r}")


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


# ── Shared singletons ────────────────────────────────────────────────────────

llm: LLMAdapter = _make_llm()
stt: STTAdapter = _make_stt()
tts: TTSAdapter = _make_tts()
orchestrator: DialogOrchestrator = DialogOrchestrator(stt=stt, llm=llm, tts=tts)
