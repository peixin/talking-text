"""Business configuration loader.

Reads config.toml (committed to git, no secrets).
For secrets and infrastructure URLs, see app/config.py (pydantic-settings + .env).
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "config.toml"


@dataclass(frozen=True)
class AdapterConfig:
    llm_provider: str
    stt_provider: str
    tts_provider: str


@dataclass(frozen=True)
class AuthConfig:
    session_max_age_days: int
    max_login_attempts: int

    @property
    def session_max_age_seconds(self) -> int:
        return self.session_max_age_days * 24 * 60 * 60


@dataclass(frozen=True)
class AppConfig:
    adapter: AdapterConfig
    auth: AuthConfig


def _load() -> AppConfig:
    with open(_CONFIG_PATH, "rb") as f:
        raw = tomllib.load(f)
    adapter = raw["adapter"]
    auth = raw["auth"]
    return AppConfig(
        adapter=AdapterConfig(
            llm_provider=adapter["llm_provider"],
            stt_provider=adapter["stt_provider"],
            tts_provider=adapter["tts_provider"],
        ),
        auth=AuthConfig(
            session_max_age_days=auth["session_max_age_days"],
            max_login_attempts=auth["max_login_attempts"],
        ),
    )


# Singleton — loaded once at import time (startup)
app_config: AppConfig = _load()
