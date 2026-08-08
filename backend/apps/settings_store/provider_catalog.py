"""Typed host configuration for built-in coding-agent providers."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass

PROVIDER_CATALOG_SCOPE = "host"
PROVIDER_CATALOG_KEY = "provider_catalog"

logger = logging.getLogger(__name__)


def parse_provider_catalog(value: str) -> "ProviderCatalog":
    """Read the remaining settings-owned global launch default defensively."""

    try:
        raw = json.loads(value)
    except ValueError as exc:
        logger.error(
            "provider catalog is not valid JSON; falling back to first-run "
            "defaults: %s",
            exc,
        )
        return ProviderCatalog()
    if not isinstance(raw, dict):
        logger.error(
            "provider catalog is not a JSON object; falling back to first-run defaults"
        )
        return ProviderCatalog()

    default = raw.get("global_default")
    if default is None:
        return ProviderCatalog()
    if not isinstance(default, dict):
        logger.error("provider catalog default is not an object; dropping it")
        return ProviderCatalog()
    if set(default) - {"provider", "model", "reasoning"}:
        logger.error("provider catalog default has unknown fields; dropping it")
        return ProviderCatalog()

    provider = default.get("provider")
    model = default.get("model")
    reasoning = default.get("reasoning")
    if not isinstance(provider, str):
        logger.error("provider catalog default has no string provider; dropping it")
        return ProviderCatalog()
    if model is not None and not isinstance(model, str):
        logger.error("provider catalog default has a non-string model; dropping it")
        return ProviderCatalog()
    if reasoning is not None and not isinstance(reasoning, str):
        logger.error("provider catalog default has non-string reasoning; dropping it")
        return ProviderCatalog()
    return ProviderCatalog(
        global_default=GlobalLaunchDefault(
            provider=provider,
            model=model,
            reasoning=reasoning,
        )
    )


def load_provider_catalog() -> "ProviderCatalog":
    """Read the host catalog, preserving first-run defaults on absent data."""

    from apps.settings_store.models import AppSetting

    value = (
        AppSetting.objects.filter(
            scope=PROVIDER_CATALOG_SCOPE,
            key=PROVIDER_CATALOG_KEY,
        )
        .values_list("value", flat=True)
        .first()
    )
    if value is None:
        return ProviderCatalog()
    return parse_provider_catalog(value)


@dataclass(frozen=True)
class GlobalLaunchDefault:
    """The settings-owned launch triple after transport validation."""

    provider: str
    model: str | None = None
    reasoning: str | None = None


@dataclass(frozen=True)
class ProviderCatalog:
    global_default: GlobalLaunchDefault | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def validate_global_launch_default(default: GlobalLaunchDefault | None) -> None:
    """Require the settings-owned launch triple to exist in catalog tables."""

    if default is None:
        return

    from worktracker.models import AgentModel, Provider, ReasoningLevel

    provider = Provider.objects.filter(slug=default.provider).first()
    if provider is None:
        raise ValueError(f"Provider '{default.provider}' is not in the catalog.")
    model = None
    if default.model is not None:
        model = AgentModel.objects.filter(provider=provider, name=default.model).first()
        if model is None:
            raise ValueError(
                f"Model '{default.model}' is not in the catalog for provider "
                f"'{default.provider}'."
            )
    if default.reasoning is None:
        return
    if model is None:
        raise ValueError("Choose a catalog model before configuring reasoning.")
    reasoning = ReasoningLevel.objects.filter(name=default.reasoning).first()
    if (
        reasoning is None
        or not model.permitted_reasoning_levels.filter(pk=reasoning.pk).exists()
    ):
        raise ValueError(
            f"Reasoning '{default.reasoning}' is not permitted for model "
            f"'{default.model}'."
        )
