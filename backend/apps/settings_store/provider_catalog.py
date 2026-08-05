"""Typed host configuration for built-in coding-agent providers."""

from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    field_validator,
)

Provider = Literal["claude", "agy", "codex", "gemini"]
PROVIDER_CATALOG_SCOPE = "host"
PROVIDER_CATALOG_KEY = "provider_catalog"

_CATALOG_FIELDS = ("global_default",)

logger = logging.getLogger(__name__)


def parse_provider_catalog(value: str) -> "ProviderCatalog":
    """Read the remaining settings-owned global launch default defensively."""

    try:
        return ProviderCatalog.model_validate_json(value)
    except ValueError as exc:
        logger.warning("provider catalog unreadable, salvaging default: %s", exc)

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

    salvaged = {field: raw[field] for field in _CATALOG_FIELDS if field in raw}
    for candidate in (salvaged, {}):
        try:
            return ProviderCatalog.model_validate(candidate)
        except ValueError as exc:
            logger.warning("provider catalog salvage attempt failed: %s", exc)
    logger.error("provider catalog unrecoverable; falling back to first-run defaults")
    return ProviderCatalog()


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


class GlobalLaunchDefault(BaseModel):
    """The catalog's optional launch default.

    This settings-owned shape only normalizes values. Catalog foreign-key
    validation is applied by the launch-binding write seam that owns the triple.
    """

    model_config = ConfigDict(extra="forbid")

    provider: Provider
    model: str | None = None
    reasoning: str | None = None

    @field_validator("provider", mode="before")
    @classmethod
    def strip_provider(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("model", "reasoning", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if not isinstance(value, str):
            return value
        return value.strip() or None


class ProviderCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    global_default: GlobalLaunchDefault | None = None


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
        model = AgentModel.objects.filter(
            provider=provider, name=default.model
        ).first()
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
    if reasoning is None or not model.permitted_reasoning_levels.filter(
        pk=reasoning.pk
    ).exists():
        raise ValueError(
            f"Reasoning '{default.reasoning}' is not permitted for model "
            f"'{default.model}'."
        )
