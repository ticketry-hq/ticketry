"""Resolve one immutable type/state launch configuration per task launch."""

from __future__ import annotations

from dataclasses import dataclass

from worktracker.models import Issue
from worktracker.services.launch_bindings import (
    LaunchBindingError,
    apply_global_launch_default,
    resolve_launch_binding,
    resolve_issue_launch_binding,
    validate_provider_options,
)


@dataclass(frozen=True)
class ResolvedLaunchConfiguration:
    """Launch-time snapshot; later binding edits cannot mutate a live command."""

    prompt: str
    agent: str
    model: str | None
    reasoning: str | None
    required_skills: tuple[str, ...] = ()
    # Display name of the workflow state whose binding produced this
    # configuration — the current state for an interactive launch, the frozen
    # destination state for an automated one. Persisted verbatim as the run's
    # launch snapshot (#693); a later rename of that state does not rewrite it.
    state_name: str | None = None


class LaunchConfigurationError(ValueError):
    """A stable launch-policy rejection surfaced consistently by every door."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def resolve_task_launch_configuration(
    task_id: str,
    *,
    agent_override: str | None = None,
    destination_state_id: str | None = None,
) -> ResolvedLaunchConfiguration:
    """Resolve current/destination policy and apply an explicit agent override.

    ``destination_state_id`` freezes post-transition automation to the state in
    its committed event even if the task moves again before callback delivery.
    Model and reasoning defaults belong to their configured provider. Choosing
    a different provider explicitly therefore drops those defaults instead of
    forwarding an option validated for another CLI.

    Whatever the binding leaves unset falls through to the live host launch
    default (read here, never snapshotted into the binding). A binding naming a
    deactivated provider is not substituted: it is blocked with
    ``provider_not_activated``. Automated launches enter through this same door.
    """

    issue = (
        Issue.objects.select_related("issue_type", "state")
        .filter(pk=task_id, type="task")
        .first()
    )
    if issue is None:
        raise LaunchConfigurationError("task_not_found")

    try:
        from apps.settings_store.provider_catalog import load_provider_catalog
        from worktracker.services.provider_catalog import activated_provider_slugs

        catalog = load_provider_catalog()
        activated_providers = activated_provider_slugs()
        binding = (
            resolve_launch_binding(
                issue.issue_type_id,
                destination_state_id,
                activated_providers=activated_providers,
            )
            if destination_state_id is not None
            else resolve_issue_launch_binding(
                issue,
                activated_providers=activated_providers,
            )
        )
        configured_agent = binding.provider_slug
        agent = agent_override or configured_agent
        provider_changed = bool(
            agent_override and configured_agent and agent_override != configured_agent
        )
        model = None if provider_changed else binding.model_name
        reasoning = None if provider_changed else binding.reasoning_name
        agent, model, reasoning = apply_global_launch_default(
            agent=agent,
            model=model,
            reasoning=reasoning,
            catalog=catalog,
        )
        if agent is None:
            raise LaunchBindingError(
                "agent_not_configured",
                "This launch binding has no resolved agent/provider.",
                field="agent",
            )
        agent, model, reasoning = validate_provider_options(
            agent=agent,
            model=model,
            reasoning=reasoning,
            activated_providers=activated_providers,
        )
    except LaunchBindingError as exc:
        raise LaunchConfigurationError(exc.code) from exc

    assert agent is not None
    return ResolvedLaunchConfiguration(
        prompt=binding.prompt,
        agent=agent,
        model=model,
        reasoning=reasoning,
        required_skills=tuple(binding.required_skills),
        # The binding is keyed by the state this launch resolved against, so
        # its own state row is the one the run is launching in.
        state_name=binding.state.name,
    )
