"""Post-commit workflow automation at the public state-change seam."""

from __future__ import annotations

import json
import uuid

import pytest
from django.db import transaction
from django.test import Client, override_settings

from apps.execution import signals as execution_signals
from apps.runs import rust_port
from apps.runs.models import AutomationAttempt
from apps.settings_store.models import AppSetting
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
    Workspace,
)
from worktracker.services.projects import create_project
from worktracker.signals import issue_state_changed


pytestmark = pytest.mark.django_db(transaction=True)
runs_client = Client()


def _catalog_selection(provider_slug, model_name, reasoning_name=None):
    provider = Provider.objects.get(slug=provider_slug)
    if not provider.activated:
        provider.activated = True
        provider.save(update_fields=("activated",))
    model, _ = AgentModel.objects.get_or_create(
        provider=provider,
        name=model_name,
    )
    reasoning = None
    if reasoning_name is not None:
        reasoning, _ = ReasoningLevel.objects.get_or_create(name=reasoning_name)
        model.permitted_reasoning_levels.add(reasoning)
    return model, reasoning


def _automation_policy(*, auto_start=True):
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="automation", name="Automation"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Automation", slug="AUTO"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        workflow_revision=7,
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    before = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    after = State.objects.create(
        id=uuid.uuid4(), project=project, name="Review", group="started"
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=before,
        to_state=after,
    )
    model, reasoning = _catalog_selection("codex", "gpt-5-codex", "high")
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=after,
        auto_start=auto_start,
        prompt="Review the committed implementation",
        model=model,
        reasoning=reasoning,
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=module,
        state=before,
        name="Implementation slice",
        sequence_id=2,
    )
    return issue, after


def test_auto_start_state_launches_once_after_the_destination_commits(monkeypatch):
    issue, after = _automation_policy()
    launches = []
    published = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-1"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    # The attempt outcome is a durable Rust command now; observing it there
    # is what proves the outcome reached its authoritative owner.
    record_outcome = rust_port.record_attempt_outcome

    def observed_outcome(attempt_id, **outcome):
        result = record_outcome(attempt_id, **outcome)
        published.append(result)
        return result

    monkeypatch.setattr(rust_port, "record_attempt_outcome", observed_outcome)

    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    attempt = AutomationAttempt.objects.get(issue=issue)
    assert issue.state_id == after.id
    assert attempt.status == AutomationAttempt.Status.SUCCEEDED
    assert attempt.agent_run_id == "agent-run-1"
    assert [entry["attempt_id"] for entry in published] == [str(attempt.id)]
    assert len(launches) == 1
    launch = launches[0]
    assert launch["agent"] == "codex"
    assert launch["project_id"] == str(issue.project_id)
    assert launch["module_id"] == str(issue.parent_id)
    assert launch["task_id"] == str(issue.id)
    assert launch["scope"] == "task"
    assert launch["launch_configuration"].prompt == (
        "Review the committed implementation"
    )


def test_fresh_story_auto_starts_spec_and_tickets_then_stops_at_implement(
    monkeypatch,
):
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="matt-defaults", name="Matt defaults"
    )
    project = create_project(
        name="Matt defaults",
        slug="MAT",
        workspace_slug=workspace.slug,
    )
    _catalog_selection("codex", "gpt-5.4")
    AppSetting.objects.create(
        scope="host",
        key="provider_catalog",
        value=json.dumps(
            {
                "global_default": {"provider": "codex", "model": "gpt-5.4"},
            }
        ),
        updated_at="2026-07-27T00:00:00+00:00",
    )
    story_type = IssueType.objects.get(project=project, name="Story")
    module_type = IssueType.objects.get(project=project, level="module")
    states = {state.name: state for state in State.objects.filter(project=project)}
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )
    story = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=story_type,
        parent=module,
        state=states["Grill"],
        name="Story",
        sequence_id=2,
    )
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return f"agent-run-{len(launches)}"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)

    story.state = states["Spec"]
    story.save(update_fields=["state", "updated_at"])
    story.state = states["Tickets"]
    story.save(update_fields=["state", "updated_at"])
    story.state = states["Implement"]
    story.save(update_fields=["state", "updated_at"])

    assert [launch["launch_configuration"].required_skills for launch in launches] == [
        ("to-spec",),
        ("to-tickets",),
    ]
    assert AutomationAttempt.objects.filter(issue=story).count() == 2


def test_auto_start_launches_from_an_alternate_incoming_edge(monkeypatch):
    issue, after = _automation_policy()
    alternate = State.objects.create(
        id=uuid.uuid4(), project=issue.project, name="Rework", group="started"
    )
    IssueTypeTransition.objects.create(
        issue_type=issue.issue_type,
        from_state=alternate,
        to_state=after,
    )
    Issue.objects.filter(pk=issue.pk).update(state=alternate)
    issue.refresh_from_db()
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-alternate"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    assert len(launches) == 1
    assert AutomationAttempt.objects.filter(issue=issue).count() == 1


@pytest.mark.parametrize("transition_origin", ["human", "agent"])
def test_auto_start_is_transition_origin_blind(monkeypatch, transition_origin):
    issue, after = _automation_policy()
    from_state_id = str(issue.state_id)
    Issue.objects.filter(pk=issue.pk).update(state=after)
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return f"agent-run-{transition_origin}"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    execution_signals.launch_workflow_automation(
        issue_id=str(issue.id),
        project_id=str(issue.project_id),
        transition_id=str(uuid.uuid4()),
        from_state_id=from_state_id,
        to_state_id=str(after.id),
        transition_snapshot={
            "from": from_state_id,
            "to": str(after.id),
            "auto_start": True,
            "workflow_revision": issue.issue_type.workflow_revision,
        },
        transition_origin=transition_origin,
    )

    assert len(launches) == 1
    assert AutomationAttempt.objects.filter(issue=issue).count() == 1


def test_replayed_transition_event_does_not_launch_twice(monkeypatch):
    issue, after = _automation_policy()
    launches = []
    events = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-1"

    def capture(sender, **kwargs):
        events.append(kwargs)

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    issue_state_changed.connect(capture, dispatch_uid="test-capture-transition")
    try:
        before_id = str(issue.state_id)
        issue.state = after
        issue.save(update_fields=["state", "updated_at"])
        replay = {key: value for key, value in events[0].items() if key != "signal"}
        issue_state_changed.send_robust(sender=Issue, **replay)
    finally:
        issue_state_changed.disconnect(dispatch_uid="test-capture-transition")

    assert AutomationAttempt.objects.filter(issue=issue).count() == 1
    assert len(launches) == 1
    assert events[0]["from_state_id"] == before_id


def test_binding_without_auto_start_commits_without_creating_an_attempt(monkeypatch):
    issue, after = _automation_policy(auto_start=False)

    async def unexpected_spawn(**kwargs):
        raise AssertionError(f"disabled automation launched with {kwargs}")

    monkeypatch.setattr("apps.execution.driver.spawn_run", unexpected_spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    assert issue.state_id == after.id
    assert not AutomationAttempt.objects.filter(issue=issue).exists()


def test_state_without_binding_commits_without_creating_an_attempt(monkeypatch):
    issue, after = _automation_policy()
    LaunchBinding.objects.filter(issue_type=issue.issue_type, state=after).delete()

    async def unexpected_spawn(**kwargs):
        raise AssertionError(f"unbound automation launched with {kwargs}")

    monkeypatch.setattr("apps.execution.driver.spawn_run", unexpected_spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    assert not AutomationAttempt.objects.filter(issue=issue).exists()


def test_issue_type_without_workflow_ignores_automation(monkeypatch):
    issue, after = _automation_policy()
    issue.issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=issue.project,
        name="Unconfigured task",
        level="task",
    )
    issue.save(update_fields=["issue_type", "updated_at"])

    async def unexpected_spawn(**kwargs):
        raise AssertionError(f"unsupported project launched with {kwargs}")

    monkeypatch.setattr("apps.execution.driver.spawn_run", unexpected_spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    assert issue.state_id == after.id
    assert not AutomationAttempt.objects.filter(issue=issue).exists()


def test_startup_failure_marks_attempt_failed_without_reverting_state(monkeypatch):
    issue, after = _automation_policy()
    published = []

    async def fail_spawn(**kwargs):
        raise RuntimeError("tmux unavailable")

    monkeypatch.setattr("apps.execution.driver.spawn_run", fail_spawn)
    # The attempt outcome is a durable Rust command now; observing it there
    # is what proves the outcome reached its authoritative owner.
    record_outcome = rust_port.record_attempt_outcome

    def observed_outcome(attempt_id, **outcome):
        result = record_outcome(attempt_id, **outcome)
        published.append(result)
        return result

    monkeypatch.setattr(rust_port, "record_attempt_outcome", observed_outcome)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    attempt = AutomationAttempt.objects.get(issue=issue)
    assert issue.state_id == after.id
    assert attempt.status == AutomationAttempt.Status.FAILED
    assert attempt.error == "tmux unavailable"
    assert attempt.agent_run_id is None
    assert [entry["attempt_id"] for entry in published] == [str(attempt.id)]


def test_destination_binding_selects_the_automated_launch_configuration(monkeypatch):
    issue, after = _automation_policy()
    model, reasoning = _catalog_selection("claude", "sonnet", "medium")
    LaunchBinding.objects.create(
        issue_type=issue.issue_type,
        state=issue.state,
        prompt="Continue implementation",
        model=model,
        reasoning=reasoning,
    )
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-destination"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    configuration = launches[0]["launch_configuration"]
    assert configuration.prompt == "Review the committed implementation"
    assert configuration.agent == "codex"
    assert configuration.model == "gpt-5-codex"
    assert configuration.reasoning == "high"


def test_each_transition_uses_its_own_destination_binding(monkeypatch):
    issue, middle = _automation_policy()
    final = State.objects.create(
        id=uuid.uuid4(), project=issue.project, name="Done", group="completed"
    )
    IssueTypeTransition.objects.create(
        issue_type=issue.issue_type,
        from_state=middle,
        to_state=final,
    )
    model, reasoning = _catalog_selection("claude", "sonnet", "medium")
    LaunchBinding.objects.create(
        issue_type=issue.issue_type,
        state=final,
        auto_start=True,
        prompt="Close the completed work",
        model=model,
        reasoning=reasoning,
    )
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return f"agent-run-{len(launches)}"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    with transaction.atomic():
        issue.state = middle
        issue.save(update_fields=["state", "updated_at"])
        issue.state = final
        issue.save(update_fields=["state", "updated_at"])

    assert [launch["launch_configuration"].prompt for launch in launches] == [
        "Review the committed implementation",
        "Close the completed work",
    ]
    assert AutomationAttempt.objects.filter(issue=issue).count() == 2


def test_delayed_event_uses_frozen_historical_auto_start(monkeypatch):
    issue, after = _automation_policy()
    launches = []
    events = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-delayed"

    def capture(sender, **kwargs):
        events.append(kwargs)

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    issue_state_changed.disconnect(dispatch_uid="execution_launch_workflow_automation")
    issue_state_changed.connect(capture, dispatch_uid="test-capture-delayed")
    try:
        issue.state = after
        issue.save(update_fields=["state", "updated_at"])
    finally:
        issue_state_changed.disconnect(dispatch_uid="test-capture-delayed")
        issue_state_changed.connect(
            execution_signals.launch_workflow_automation,
            dispatch_uid="execution_launch_workflow_automation",
        )

    binding = LaunchBinding.objects.get(issue_type=issue.issue_type, state=after)
    binding.auto_start = False
    binding.save(update_fields=["auto_start", "updated_at"])
    issue.issue_type.workflow_revision += 1
    issue.issue_type.save(update_fields=["workflow_revision", "updated_at"])
    replay = {key: value for key, value in events[0].items() if key != "signal"}
    issue_state_changed.send_robust(sender=Issue, **replay)

    attempt = AutomationAttempt.objects.get(issue=issue)
    assert len(launches) == 1
    assert attempt.workflow_revision == 7


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_django_retry_route_is_retired_in_favour_of_the_rust_command():
    """Retry has one authority, and it is not Django.

    Automation Attempt retry is an authored Rust GraphQL command that Studio
    calls directly. Its own idempotency — one retry child per source attempt,
    repeated requests returning that same child — is proved against the table's
    owner in the Rust suite. What must remain true here is that the legacy
    Django route cannot become a second writer for the same lineage.
    """

    response = runs_client.post(
        f"/api/automation-attempts/{uuid.uuid4()}/retry"
    )

    assert response.status_code == 410
    assert response.json()["detail"] == "django_slice3_write_disabled"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_required_skill_failure_is_actionable_and_retryable(monkeypatch):
    issue, after = _automation_policy()

    async def rejected_spawn(**kwargs):
        raise RequiredSkillUnavailable(
            provider="codex",
            skill="code-review",
            reason="collision",
            message="A different provider-visible skill already reserves 'code-review'.",
        )

    monkeypatch.setattr("apps.execution.driver.spawn_run", rejected_spawn)
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    failed = AutomationAttempt.objects.get(issue=issue)
    assert failed.status == AutomationAttempt.Status.FAILED
    assert failed.retryable is True
    assert failed.error_details == {
        "code": "required_skill_unavailable",
        "provider": "codex",
        "skill": "code-review",
        "reason": "collision",
        "detail": "A different provider-visible skill already reserves 'code-review'.",
        "remediation": (
            "Rename the provider-visible skill or change its declared name, then "
            "retry. Ticketry will not modify user-installed skills."
        ),
        "retryable": True,
    }

    # The failure stays visible and retryable. Performing the retry is the
    # Rust command's job, so this test stops at the durable, actionable state.
    assert AutomationAttempt.objects.filter(issue=issue).count() == 1
