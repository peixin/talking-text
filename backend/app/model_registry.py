"""Model registry — loads models.toml into queryable per-model metadata.

Drives context-limit checks and capability gating now; cost calculation later
(pricing is parsed and held but not yet consumed). Keyed by "<provider>/<model>"
because the same model costs differently per channel.
"""

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

_REGISTRY_PATH = Path(__file__).parent.parent / "models.toml"

_DEFAULT_CONTEXT_LIMIT = 131072


@dataclass(frozen=True)
class PriceTier:
    max_input: int  # upper bound of input tokens for this tier (token_million only)
    input: float
    output: float
    cache_hit: float = 0.0


@dataclass(frozen=True)
class Pricing:
    unit: str  # "token_million" | "char" | "audio_second" | "audio_hour" | "free"
    tiers: tuple[PriceTier, ...] = ()  # token_million
    price: float = 0.0  # char | audio_second | audio_hour (per unit)


@dataclass(frozen=True)
class ModelInfo:
    key: str  # "<provider>/<model>"
    kind: str  # "llm" | "stt" | "tts"
    context_limit: int = _DEFAULT_CONTEXT_LIMIT
    features: frozenset[str] = field(default_factory=frozenset)
    input_modalities: tuple[str, ...] = ()
    output_modalities: tuple[str, ...] = ()
    pricing: Pricing | None = None

    def supports(self, feature: str) -> bool:
        return feature in self.features


def _parse_pricing(raw: dict | None) -> Pricing | None:
    if not raw:
        return None
    unit = raw.get("unit", "free")
    if unit == "token_million":
        raw_tiers = raw.get("tiers")
        if raw_tiers:
            tiers = tuple(
                PriceTier(
                    max_input=int(t.get("max_input", 1_000_000_000)),
                    input=float(t.get("input", 0.0)),
                    output=float(t.get("output", 0.0)),
                    cache_hit=float(t.get("cache_hit", 0.0)),
                )
                for t in raw_tiers
            )
        else:  # flat single tier
            tiers = (
                PriceTier(
                    max_input=1_000_000_000,
                    input=float(raw.get("input", 0.0)),
                    output=float(raw.get("output", 0.0)),
                    cache_hit=float(raw.get("cache_hit", 0.0)),
                ),
            )
        return Pricing(unit=unit, tiers=tiers)
    return Pricing(unit=unit, price=float(raw.get("price", 0.0)))


class ModelRegistry:
    def __init__(
        self, models: dict[tuple[str, str], ModelInfo], default_context_limit: int
    ) -> None:
        self._models = models
        self._default_context_limit = default_context_limit

    def get(self, provider: str, model: str) -> ModelInfo | None:
        return self._models.get((provider, model))

    def context_limit(self, provider: str, model: str) -> int:
        info = self.get(provider, model)
        return info.context_limit if info else self._default_context_limit


def _load() -> ModelRegistry:
    with open(_REGISTRY_PATH, "rb") as f:
        raw = tomllib.load(f)
    default_ctx = int(raw.get("defaults", {}).get("context_limit", _DEFAULT_CONTEXT_LIMIT))

    # [model.<provider>."<model_id>"] — one table level per channel.
    models: dict[tuple[str, str], ModelInfo] = {}
    for provider, entries in raw.get("model", {}).items():
        for model_id, m in entries.items():
            models[(provider, model_id)] = ModelInfo(
                key=f"{provider}/{model_id}",
                kind=m.get("kind", "llm"),
                context_limit=int(m.get("context_limit", default_ctx)),
                features=frozenset(m.get("features", [])),
                input_modalities=tuple(m.get("input_modalities", [])),
                output_modalities=tuple(m.get("output_modalities", [])),
                pricing=_parse_pricing(m.get("pricing")),
            )
    return ModelRegistry(models, default_ctx)


# Singleton — loaded once at import (startup).
model_registry: ModelRegistry = _load()
