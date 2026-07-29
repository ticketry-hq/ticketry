"""Persistence and resolution for explicit type/current-state launch policy."""

from __future__ import annotations

from collections.abc import Set
from typing import TYPE_CHECKING

from django.db import transaction

from worktracker.launch_capabilities import PROVIDER_CAPABILITIES
from worktracker.models import IssueType, LaunchBinding, Project, State
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


def _project_pair(project_id, issue_type_id, state_id):
    try:
        Project.objects.get(pk=project_id)
    except Project.DoesNotExist as exc:
        raise LaunchBindingError("project_not_found", "Project not found.") from exc
    try:
        issue_type = IssueType.objects.get(pk=issue_type_id, project_id=project_id)
    except IssueType.DoesNotExist as exc:
        raise LaunchBindingError(
            "foreign_issue_type",
            "Work-item type does not belong to this project.",
            field="issue_type_id",
        ) from exc
    try:
        state = State.objects.get(pk=state_id, project_id=project_id)
    except State.DoesNotExist as exc:
        raise LaunchBindingError(
            "foreign_state",
            "Current state does not belong to this project.",
            field="state_id",
        ) from exc
    return issue_type, state


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
    capability = PROVIDER_CAPABILITIES.get(agent)
    if capability is None:
        raise LaunchBindingError(
            "unknown_agent",
            f"Agent/provider '{agent}' is not supported.",
            field="agent",
        )
    from apps.settings_store.provider_catalog import (
        PROVIDER_ORDER,
        load_provider_catalog,
    )

    if activated_providers is None:
        activated_providers = load_provider_catalog().activated_providers
    if agent in PROVIDER_ORDER and agent not in activated_providers:
        raise LaunchBindingError(
            "provider_not_activated",
            f"Agent/provider '{agent}' is not activated.",
            field="agent",
        )
    if model is not None and not capability.accepts(model):
        accepted = (*capability.model_aliases, *capability.model_prefixes)
        supported = ", ".join(accepted) or "the provider catalog"
        raise LaunchBindingError(
            "unsupported_model",
            f"Model '{model}' is not compatible with agent/provider '{agent}' "
            f"(supported names or prefixes: {supported}).",
            field="model",
        )
    if reasoning is not None and reasoning not in capability.reasoning_levels:
        supported = ", ".join(capability.reasoning_levels) or "none"
        raise LaunchBindingError(
            "unsupported_reasoning",
            f"Reasoning '{reasoning}' is not supported by agent/provider "
            f"'{agent}' (supported: {supported}).",
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


@transaction.atomic
def upsert_launch_binding(
    project_id,
    issue_type_id,
    state_id,
    *,
    prompt: str | None,
    agent: str | None,
    model: str | None,
    reasoning: str | None,
    required_skills=None,
) -> LaunchBinding:
    issue_type, state = _project_pair(project_id, issue_type_id, state_id)
    agent, model, reasoning = validate_provider_options(
        agent=agent, model=model, reasoning=reasoning
    )
    current = LaunchBinding.objects.filter(
        issue_type=issue_type, state=state
    ).first()
    if required_skills is None:
        required_skills = current.required_skills if current is not None else []
    required_skills = validate_required_skills(
        required_skills=required_skills,
        prompt=prompt,
    )
    binding, _ = LaunchBinding.objects.update_or_create(
        issue_type=issue_type,
        state=state,
        defaults={
            "prompt": prompt or "",
            "required_skills": required_skills,
            "agent": agent,
            "model": model,
            "reasoning": reasoning,
        },
    )
    return binding


def list_launch_bindings(project_id) -> list[LaunchBinding]:
    return list(
        LaunchBinding.objects.filter(issue_type__project_id=project_id)
        .select_related("issue_type", "state")
        .order_by("issue_type__sort_order", "state__sort_order", "id")
    )


def subtree_run_capabilities(project_id) -> dict:
    """Return enabled state ids grouped by issue type for one project."""

    capabilities = {}
    pairs = (
        LaunchBinding.objects.filter(
            issue_type__project_id=project_id,
            subtree_run_enabled=True,
        )
        .order_by("issue_type__sort_order", "state__sort_order", "id")
        .values_list("issue_type_id", "state_id")
    )
    for issue_type_id, state_id in pairs:
        capabilities.setdefault(str(issue_type_id), []).append(state_id)
    return capabilities


def get_launch_binding(issue_type_id, state_id) -> LaunchBinding | None:
    return (
        LaunchBinding.objects.filter(issue_type_id=issue_type_id, state_id=state_id)
        .select_related("issue_type", "state")
        .first()
    )


def resolve_issue_launch_binding(
    issue,
    *,
    activated_providers: Set[str] | None = None,
) -> LaunchBinding:
    if not issue.issue_type_id or not issue.state_id:
        raise LaunchBindingError(
            "launch_context_incomplete",
            "A work-item type and current state are required to resolve agent launch configuration.",
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
        agent=binding.agent,
        model=binding.model,
        reasoning=binding.reasoning,
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
    if not PROVIDER_CAPABILITIES[agent].supports_unattended:
        raise LaunchBindingError(
            "unattended_launch_unsupported",
            f"Agent/provider '{agent}' cannot launch unattended.",
            field="agent",
        )
    return binding
