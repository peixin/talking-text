"""Business configuration loader.

Reads config.toml (committed to git, no secrets).
For secrets and infrastructure URLs, see app/config.py (pydantic-settings + .env).
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config.toml"


@dataclass(frozen=True)
class LLMProviderConfig:
    model: str
    context_window: int = 32768  # token limit for the active model
    thinking: str = "disabled"  # "disabled" | "enabled"
    reasoning_effort: str = "low"  # only used when thinking = "enabled"


@dataclass(frozen=True)
class AdapterConfig:
    llm_provider: str
    stt_provider: str
    tts_provider: str
    llm: LLMProviderConfig  # active provider's resolved config


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
    llm_provider = adapter["llm_provider"]
    llm_cfg_raw = adapter.get("llm", {}).get(llm_provider, {})
    return AppConfig(
        adapter=AdapterConfig(
            llm_provider=llm_provider,
            stt_provider=adapter["stt_provider"],
            tts_provider=adapter["tts_provider"],
            llm=LLMProviderConfig(
                model=llm_cfg_raw.get("model", ""),
                context_window=llm_cfg_raw.get("context_window", 32768),
                thinking=llm_cfg_raw.get("thinking", "disabled"),
                reasoning_effort=llm_cfg_raw.get("reasoning_effort", "low"),
            ),
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
