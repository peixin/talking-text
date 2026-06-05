"""Business configuration loader.

Reads config.toml (committed to git, no secrets).
For secrets and infrastructure URLs, see app/config.py (pydantic-settings + .env).
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config.toml"


@dataclass(frozen=True)
class StageConfig:
    """One AI interaction stage's model choice. Each stage can use a different
    provider + model; base_url + API key per provider live in .env."""

    provider: str
    model: str
    context_window: int = 32768  # token limit for this stage's model
    thinking: str = "disabled"  # deepseek only: "disabled" | "enabled"
    reasoning_effort: str = "low"  # deepseek only, when thinking = "enabled"


@dataclass(frozen=True)
class AdapterConfig:
    chat: StageConfig  # dialog turns + utility text tasks (titles, mastery, calibration)
    extraction: StageConfig  # single-shot multimodal extraction (extraction_mode="single")
    perception: StageConfig  # two_stage: VLM layout-aware transcription
    structuring: StageConfig  # two_stage: text "brain" that produces language items
    extraction_mode: str  # "single" | "two_stage"
    stt_provider: str
    tts_provider: str


@dataclass(frozen=True)
class SessionConfig:
    max_turns: int  # UX soft limit — frontend prompts to start a new session
    context_hard_limit: float  # refuse new turn when last llm_input_tokens > context_window * this


@dataclass(frozen=True)
class AuthConfig:
    session_max_age_days: int
    max_login_attempts: int

    @property
    def session_max_age_seconds(self) -> int:
        return self.session_max_age_days * 24 * 60 * 60


@dataclass(frozen=True)
class DebugConfig:
    perf_logging: bool


@dataclass(frozen=True)
class AppConfig:
    adapter: AdapterConfig
    session: SessionConfig
    auth: AuthConfig
    debug: DebugConfig


def _load() -> AppConfig:
    with open(_CONFIG_PATH, "rb") as f:
        raw = tomllib.load(f)
    adapter = raw["adapter"]
    session = raw.get("session", {})
    auth = raw["auth"]
    debug = raw.get("debug", {})

    stages = adapter.get("stage", {})

    def _stage(name: str) -> StageConfig:
        s = stages[name]
        return StageConfig(
            provider=s["provider"],
            model=s.get("model", ""),
            context_window=s.get("context_window", 32768),
            thinking=s.get("thinking", "disabled"),
            reasoning_effort=s.get("reasoning_effort", "low"),
        )

    return AppConfig(
        adapter=AdapterConfig(
            chat=_stage("chat"),
            extraction=_stage("extraction"),
            perception=_stage("perception"),
            structuring=_stage("structuring"),
            extraction_mode=adapter.get("ingest", {}).get("extraction_mode", "single"),
            stt_provider=adapter["stt_provider"],
            tts_provider=adapter["tts_provider"],
        ),
        session=SessionConfig(
            max_turns=session.get("max_turns", 1000),
            context_hard_limit=session.get("context_hard_limit", 0.85),
        ),
        auth=AuthConfig(
            session_max_age_days=auth["session_max_age_days"],
            max_login_attempts=auth["max_login_attempts"],
        ),
        debug=DebugConfig(
            perf_logging=debug.get("perf_logging", False),
        ),
    )


# Singleton — loaded once at import time (startup)
app_config: AppConfig = _load()
