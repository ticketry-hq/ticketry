"""Persistence and resolution for explicit type/current-state launch policy."""

from __future__ import annotations

from collections.abc import Set
from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from worktracker.models import (
    AgentModel,
    IssueType,
    LaunchBinding,
    Provider,
    ReasoningLevel,
    State,
)
from worktracker.required_skills import (
    RequiredSkillsValidationError,
    normalize_required_skills,
)
from worktracker.services.errors import (
    ConflictError,
    FieldValidationError,
    NotFoundError,
    ValidationError,
)

if TYPE_CHECKING:
    from apps.settings_store.provider_catalog import ProviderCatalog


@dataclass(frozen=True)
class LaunchBindingMutation:
    binding: LaunchBinding
    created: bool


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


def validate_entry_skill(
    *,
    entry_skill: str | None,
    required_skills: list[str],
) -> str | None:
    entry_skill = _optional_text(entry_skill)
    if entry_skill is not None and entry_skill not in required_skills:
        raise LaunchBindingError(
            "entry_skill_must_be_required",
            "The entry skill must also appear in required skills.",
            field="entry_skill",
        )
    return entry_skill


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
    default is one (provider, model, reasoning) triple. Its reasoning only
    applies with its model, so a binding that names a different model keeps the
    CLI default rather than inheriting reasoning validated for another model.
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
    resolved_model = default.model if model is None else model
    resolved_reasoning = reasoning
    if resolved_reasoning is None and resolved_model == default.model:
        resolved_reasoning = default.reasoning
    return agent, resolved_model, resolved_reasoning


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


def _locked_workflow_context(issue_type_id, state_id, workflow_revision):
    try:
        issue_type = IssueType.objects.select_for_update().get(pk=issue_type_id)
    except IssueType.DoesNotExist as exc:
        raise NotFoundError("Work-item type not found.") from exc
    if issue_type.workflow_revision != workflow_revision:
        raise ConflictError(
            "Workflow revision is stale; read the current workflow and retry."
        )
    try:
        state = State.objects.get(pk=state_id, project_id=issue_type.project_id)
    except State.DoesNotExist as exc:
        raise ValidationError("State does not belong to this project.") from exc
    return issue_type, state


def _validated_binding_candidate(issue_type, state, current, changes):
    candidate = LaunchBinding(
        issue_type=issue_type,
        state=state,
        prompt=changes.get("prompt", current.prompt if current else ""),
        required_skills=changes.get(
            "required_skills", current.required_skills if current else []
        ),
        entry_skill=changes.get(
            "entry_skill", current.entry_skill if current else None
        ),
        model=changes.get("model", current.model if current else None),
        reasoning=changes.get("reasoning", current.reasoning if current else None),
        auto_start=changes.get(
            "auto_start", current.auto_start if current else False
        ),
        subtree_run_enabled=changes.get(
            "subtree_run_enabled",
            current.subtree_run_enabled if current else False,
        ),
    )
    try:
        candidate.full_clean(validate_unique=False, validate_constraints=False)
        if candidate.auto_start:
            validate_unattended_launch_binding(candidate)
    except DjangoValidationError as exc:
        raise FieldValidationError(
            getattr(exc, "message_dict", {"non_field_errors": exc.messages})
        ) from exc
    return candidate


def upsert_launch_binding(
    issue_type_id,
    state_id,
    *,
    workflow_revision: int,
    **changes,
) -> LaunchBindingMutation:
    """Atomically validate and persist one revision-guarded launch binding."""

    with transaction.atomic():
        issue_type, state = _locked_workflow_context(
            issue_type_id, state_id, workflow_revision
        )
        current = LaunchBinding.objects.filter(
            issue_type=issue_type, state=state
        ).first()
        candidate = _validated_binding_candidate(
            issue_type, state, current, changes
        )
        if current is None:
            candidate.save()
            binding = candidate
            created = True
        else:
            for field in (
                "prompt",
                "required_skills",
                "entry_skill",
                "model",
                "reasoning",
                "auto_start",
                "subtree_run_enabled",
            ):
                setattr(current, field, getattr(candidate, field))
            current.save()
            binding = current
            created = False
        issue_type.workflow_revision += 1
        issue_type.save(update_fields=("workflow_revision", "updated_at"))
    return LaunchBindingMutation(binding=binding, created=created)


def delete_launch_binding(
    issue_type_id,
    state_id,
    *,
    workflow_revision: int,
) -> None:
    """Atomically delete one binding and advance its workflow revision."""

    with transaction.atomic():
        issue_type, state = _locked_workflow_context(
            issue_type_id, state_id, workflow_revision
        )
        LaunchBinding.objects.filter(issue_type=issue_type, state=state).delete()
        issue_type.workflow_revision += 1
        issue_type.save(update_fields=("workflow_revision", "updated_at"))


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
