"""Persistence and resolution for explicit type/current-state launch policy."""

from __future__ import annotations

from collections.abc import Set
from typing import TYPE_CHECKING

from worktracker.models import AgentModel, LaunchBinding, Provider, ReasoningLevel
from worktracker.required_skills import (
    RequiredSkillsValidationError,
    normalize_required_skills,
)
from worktracker.services.errors import ValidationError

if TYPE_CHECKING:
    from apps.settings_store.provider_catalog import ProviderCatalog


class LaunchBindingError(ValidationError):
    def __init__(self, code: str, message: str, *, field: str | None = None):
        super().__init__(message)
        self.code = code
        self.field = field


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def validate_provider_options(
    *,
    agent: str | None,
    model: str | None,
    reasoning: str | None,
    activated_providers: Set[str] | None = None,
) -> tuple[str | None, str | None, str | None]:
    agent = _optional_text(agent)
    model = _optional_text(model)
    reasoning = _optional_text(reasoning)
    if agent is None:
        if model is not None or reasoning is not None:
            raise LaunchBindingError(
                "agent_required",
                "Choose an agent/provider before configuring model or reasoning.",
                field="agent",
            )
        return None, None, None
    provider = Provider.objects.filter(slug=agent).first()
    if provider is None:
        raise LaunchBindingError(
            "unknown_agent",
            f"Agent/provider '{agent}' is not supported.",
            field="agent",
        )
    if activated_providers is None:
        from worktracker.services.provider_catalog import activated_provider_slugs

        activated_providers = activated_provider_slugs()
    if agent not in activated_providers:
        raise LaunchBindingError(
            "provider_not_activated",
            f"Agent/provider '{agent}' is not activated.",
            field="agent",
        )
    catalog_model = None
    if model is not None:
        catalog_model = AgentModel.objects.filter(
            provider=provider, name=model
        ).first()
    if model is not None and catalog_model is None:
        raise LaunchBindingError(
            "unsupported_model",
            f"Model '{model}' is not in the catalog for agent/provider '{agent}'.",
            field="model",
        )
    if reasoning is not None and catalog_model is None:
        raise LaunchBindingError(
            "model_required",
            "Choose a catalog model before configuring reasoning.",
            field="model",
        )
    catalog_reasoning = None
    if reasoning is not None:
        catalog_reasoning = ReasoningLevel.objects.filter(name=reasoning).first()
    if reasoning is not None and (
        catalog_reasoning is None
        or not catalog_model.permitted_reasoning_levels.filter(
            pk=catalog_reasoning.pk
        ).exists()
    ):
        raise LaunchBindingError(
            "unsupported_reasoning",
            f"Reasoning '{reasoning}' is not permitted for model '{model}'.",
            field="reasoning",
        )
    return agent, model, reasoning


def validate_required_skills(
    *,
    required_skills,
    prompt: str | None,
) -> list[str]:
    try:
        normalized = normalize_required_skills(required_skills)
    except RequiredSkillsValidationError as exc:
        raise LaunchBindingError(
            "invalid_required_skills",
            str(exc),
            field="required_skills",
        ) from exc
    if normalized and not (prompt or "").strip():
        raise LaunchBindingError(
            "prompt_required_for_skills",
            "A launch binding with required skills must have a non-empty prompt.",
            field="prompt",
        )
    return normalized


def apply_global_launch_default(
    *,
    agent: str | None,
    model: str | None,
    reasoning: str | None,
    catalog: ProviderCatalog | None = None,
) -> tuple[str | None, str | None, str | None]:
    """Fill unset provider/model/reasoning from the live host launch default.

    Read at launch time and never snapshotted into a binding, so changing the
    default in Settings takes effect on the next launch with no migration. The
    default is one (provider, model, reasoning) triple: its model and reasoning
    only apply to its own provider, so a binding that names a different provider
    keeps CLI defaults rather than inheriting options validated for another CLI.
    """

    if catalog is None:
        from apps.settings_store.provider_catalog import load_provider_catalog

        catalog = load_provider_catalog()
    default = catalog.global_default
    if default is None:
        return agent, model, reasoning
    if agent is None:
        return default.provider, default.model, default.reasoning
    if agent != default.provider:
        return agent, model, reasoning
    return (
        agent,
        default.model if model is None else model,
        default.reasoning if reasoning is None else reasoning,
    )


def list_launch_bindings(project_id) -> list[LaunchBinding]:
    return list(
        LaunchBinding.objects.filter(issue_type__project_id=project_id)
        .select_related("issue_type", "state", "model__provider", "reasoning")
        .order_by("issue_type__sort_order", "state__sort_order", "id")
    )


def get_launch_binding(issue_type_id, state_id) -> LaunchBinding | None:
    return (
        LaunchBinding.objects.filter(issue_type_id=issue_type_id, state_id=state_id)
        .select_related("issue_type", "state", "model__provider", "reasoning")
        .first()
    )


def resolve_issue_launch_binding(
    issue,
    *,
    activated_providers: Set[str] | None = None,
) -> LaunchBinding:
    if not issue.state_id:
        raise LaunchBindingError(
            "launch_context_incomplete",
            "A current state is required to resolve agent launch configuration.",
        )
    return resolve_launch_binding(
        issue.issue_type_id,
        issue.state_id,
        activated_providers=activated_providers,
    )


def resolve_launch_binding(
    issue_type_id,
    state_id,
    *,
    activated_providers: Set[str] | None = None,
) -> LaunchBinding:
    """Resolve launch policy for one explicit work-item type/state pair."""

    binding = get_launch_binding(issue_type_id, state_id)
    _validated_launch_binding(
        binding,
        activated_providers=activated_providers,
    )
    assert binding is not None
    return binding


def _validated_launch_binding(
    binding: LaunchBinding | None,
    *,
    activated_providers: Set[str] | None = None,
) -> tuple[LaunchBinding, str | None]:
    """Validate policy shared by interactive and unattended launch doors."""

    # A row that only carries ``subtree_run_enabled`` is not a configuration.
    # Reading its existence as one would refuse the same user-visible situation
    # with a different code than an absent row does.
    if binding is None or not binding.has_launch_policy:
        raise LaunchBindingError(
            "binding_not_configured",
            "No agent launch binding is configured for this work-item type and current state.",
        )
    if not binding.prompt.strip():
        raise LaunchBindingError(
            "prompt_not_configured",
            "This launch binding has no resolved prompt; an agent cannot be launched.",
            field="prompt",
        )
    agent, _model, _reasoning = validate_provider_options(
        agent=binding.provider_slug,
        model=binding.model_name,
        reasoning=binding.reasoning_name,
        activated_providers=activated_providers,
    )
    return binding, agent


def validate_unattended_launch_binding(binding: LaunchBinding | None) -> LaunchBinding:
    """Require a binding that can start without an interactive override."""

    binding, agent = _validated_launch_binding(binding)
    agent, _model, _reasoning = apply_global_launch_default(
        agent=agent, model=None, reasoning=None
    )
    if agent is None:
        raise LaunchBindingError(
            "agent_not_configured",
            "This launch binding has no resolved agent/provider.",
            field="agent",
        )
    from worktracker.services.provider_catalog import provider_supports_unattended

    if not provider_supports_unattended(agent):
        raise LaunchBindingError(
            "unattended_launch_unsupported",
            f"Agent/provider '{agent}' cannot launch unattended.",
            field="agent",
        )
    return binding
