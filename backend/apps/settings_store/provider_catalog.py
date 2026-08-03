"""Typed host configuration for built-in coding-agent providers."""

from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

Provider = Literal["claude", "codex", "gemini"]
PROVIDER_ORDER: tuple[Provider, ...] = ("claude", "codex", "gemini")
PROVIDER_CATALOG_SCOPE = "host"
PROVIDER_CATALOG_KEY = "provider_catalog"

_CATALOG_FIELDS = ("activated_providers", "global_default")

logger = logging.getLogger(__name__)


def parse_provider_catalog(value: str) -> "ProviderCatalog":
    """Read a stored catalog without ever widening activation on bad data.

    Activation is a security-relevant gate, so an unreadable document must not
    silently re-activate every provider. The salvage narrows instead: fields
    this build does not know are dropped, provider slugs it does not know are
    dropped, and a ``global_default`` the surviving activation set rejects is
    dropped on its own rather than discarding the activation set with it. Only
    a document with no recoverable activation at all falls back to first-run
    defaults, and every step says so in the log.
    """

    try:
        return ProviderCatalog.model_validate_json(value)
    except ValueError as exc:
        logger.warning("provider catalog unreadable, salvaging activation: %s", exc)

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
            "provider catalog is not a JSON object; falling back to first-run "
            "defaults"
        )
        return ProviderCatalog()

    salvaged = {field: raw[field] for field in _CATALOG_FIELDS if field in raw}
    stored = salvaged.get("activated_providers")
    if isinstance(stored, (list, tuple, set, frozenset)):
        # A provider slug a newer build wrote is unknown here — drop it rather
        # than let the whole document fail into "everything activated".
        salvaged["activated_providers"] = [
            provider for provider in PROVIDER_ORDER if provider in stored
        ]
    # Keep the default when the activation set alone was the problem; drop only
    # the default when it is the field the activation set rejects.
    without_default = {
        field: stored_value
        for field, stored_value in salvaged.items()
        if field != "global_default"
    }
    for candidate in (salvaged, without_default):
        try:
            return ProviderCatalog.model_validate(candidate)
        except ValueError as exc:
            logger.warning("provider catalog salvage attempt failed: %s", exc)
    logger.error(
        "provider catalog unrecoverable; falling back to first-run defaults"
    )
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

    Only normalizes here. Whether the provider/model/reasoning triple is
    *valid* is decided once, by ``ProviderCatalog``, through the canonical
    ``services.launch_bindings.validate_provider_options`` — which also checks
    activation and produces the better error messages.
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

    activated_providers: frozenset[Provider] = Field(
        default_factory=lambda: frozenset(PROVIDER_ORDER)
    )
    global_default: GlobalLaunchDefault | None = None

    @field_serializer("activated_providers")
    def serialize_activated_providers(
        self, activated_providers: frozenset[Provider]
    ) -> list[Provider]:
        return [
            provider
            for provider in PROVIDER_ORDER
            if provider in activated_providers
        ]

    @model_validator(mode="after")
    def validate_global_default_is_activated(self):
        if self.global_default is not None:
            from worktracker.services.launch_bindings import (
                LaunchBindingError,
                validate_provider_options,
            )

            try:
                validate_provider_options(
                    agent=self.global_default.provider,
                    model=self.global_default.model,
                    reasoning=self.global_default.reasoning,
                    activated_providers=self.activated_providers,
                )
            except LaunchBindingError as exc:
                raise ValueError(exc.message) from exc
        return self
