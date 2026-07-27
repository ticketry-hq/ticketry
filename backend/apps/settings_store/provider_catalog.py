"""Typed host configuration for built-in coding-agent providers."""

from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

from worktracker.launch_capabilities import PROVIDER_CAPABILITIES


Provider = Literal["claude", "codex", "gemini"]
PROVIDER_ORDER: tuple[Provider, ...] = ("claude", "codex", "gemini")
PROVIDER_CATALOG_SCOPE = "host"
PROVIDER_CATALOG_KEY = "provider_catalog"


def load_provider_catalog() -> "ProviderCatalog":
    """Read the host catalog, preserving first-run defaults on absent/bad data."""

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
    try:
        return ProviderCatalog.model_validate_json(value)
    except ValueError:
        return ProviderCatalog()


class GlobalLaunchDefault(BaseModel):
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

    @model_validator(mode="after")
    def validate_provider_options(self):
        capability = PROVIDER_CAPABILITIES[self.provider]
        if self.model is not None and not capability.accepts(self.model):
            raise ValueError(f"model is not valid for provider '{self.provider}'")
        if (
            self.reasoning is not None
            and self.reasoning not in capability.reasoning_levels
        ):
            raise ValueError(
                f"reasoning is not valid for provider '{self.provider}'"
            )
        return self


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
