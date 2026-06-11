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
    provider + model; base_url + API key per provider live in .env. The model's
    context window / capabilities / pricing come from models.toml (model_registry)."""

    provider: str
    model: str
    thinking: str = "disabled"  # deepseek only: "disabled" | "enabled"
    reasoning_effort: str = "low"  # deepseek only, when thinking = "enabled"


@dataclass(frozen=True)
class TaskConfig:
    """Per-task generation budget — how long an output we request for a given
    use (chat reply, title, extraction, …). A task decision, not a model property."""

    max_tokens: int
    temperature: float = 0.7


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
class ScopeConfig:
    """Scope V2 stretch budget — see docs/phase2-mastery-stretch.md §3."""

    stretch_ratio: float  # fraction of base words offered as next-unit stretch (0 disables)
    stretch_max_words: int  # hard cap on the stretch list length


@dataclass(frozen=True)
class SessionConfig:
    max_turns: int  # UX soft limit — frontend prompts to start a new session
    context_hard_limit: float  # refuse new turn when last llm_input_tokens > context_window * this


@dataclass(frozen=True)
class LimitsConfig:
    """Input-size guards — backend-authoritative; mirrored in frontend lib/constants.ts."""

    chat_text_max_chars: int  # typed chat turn length
    chat_recording_max_seconds: int  # chat mic auto-stop (enforced by frontend)
    ingest_text_max_chars: int  # ingest description / pasted text length
    ingest_max_images: int  # images per /ingest/extract request
    ingest_image_max_mb: int  # per uploaded image
    ingest_recording_max_seconds: int  # ingest voice note auto-stop (frontend)
    audio_upload_max_mb: int  # backstop for any uploaded audio clip

    @property
    def ingest_image_max_bytes(self) -> int:
        return self.ingest_image_max_mb * 1024 * 1024

    @property
    def audio_upload_max_bytes(self) -> int:
        return self.audio_upload_max_mb * 1024 * 1024


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
    scope: ScopeConfig
    session: SessionConfig
    limits: LimitsConfig
    auth: AuthConfig
    debug: DebugConfig
    tasks: dict[str, TaskConfig]  # keyed by task name (see config.toml [task.*])

    def task(self, name: str) -> TaskConfig:
        try:
            return self.tasks[name]
        except KeyError:
            raise KeyError(f"No [task.{name}] in config.toml") from None


# Task names the code asks for via app_config.task(...) — validated at load time
# so a missing/renamed [task.*] section fails at startup, not mid-request.
_REQUIRED_TASKS = frozenset(
    {
        "dialog",
        "greeting",
        "title",
        "calibration",
        "mastery",
        "persona",
        "group_naming",
        "extraction",
        "perception",
    }
)


def _load() -> AppConfig:
    with open(_CONFIG_PATH, "rb") as f:
        raw = tomllib.load(f)
    adapter = raw["adapter"]
    scope = raw.get("scope", {})
    session = raw.get("session", {})
    limits = raw.get("limits", {})
    auth = raw["auth"]
    debug = raw.get("debug", {})

    stages = adapter.get("stage", {})

    def _stage(name: str) -> StageConfig:
        s = stages[name]
        return StageConfig(
            provider=s["provider"],
            model=s.get("model", ""),
            thinking=s.get("thinking", "disabled"),
            reasoning_effort=s.get("reasoning_effort", "low"),
        )

    tasks = {
        name: TaskConfig(max_tokens=t["max_tokens"], temperature=t.get("temperature", 0.7))
        for name, t in raw.get("task", {}).items()
    }
    missing_tasks = _REQUIRED_TASKS - tasks.keys()
    if missing_tasks:
        raise KeyError(f"config.toml is missing [task.*] sections: {sorted(missing_tasks)}")

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
        scope=ScopeConfig(
            stretch_ratio=scope.get("stretch_ratio", 0.10),
            stretch_max_words=scope.get("stretch_max_words", 8),
        ),
        session=SessionConfig(
            max_turns=session.get("max_turns", 1000),
            context_hard_limit=session.get("context_hard_limit", 0.85),
        ),
        limits=LimitsConfig(
            chat_text_max_chars=limits.get("chat_text_max_chars", 500),
            chat_recording_max_seconds=limits.get("chat_recording_max_seconds", 60),
            ingest_text_max_chars=limits.get("ingest_text_max_chars", 10000),
            ingest_max_images=limits.get("ingest_max_images", 5),
            ingest_image_max_mb=limits.get("ingest_image_max_mb", 10),
            ingest_recording_max_seconds=limits.get("ingest_recording_max_seconds", 120),
            audio_upload_max_mb=limits.get("audio_upload_max_mb", 10),
        ),
        auth=AuthConfig(
            session_max_age_days=auth["session_max_age_days"],
            max_login_attempts=auth["max_login_attempts"],
        ),
        debug=DebugConfig(
            perf_logging=debug.get("perf_logging", False),
        ),
        tasks=tasks,
    )


# Singleton — loaded once at import time (startup)
app_config: AppConfig = _load()
