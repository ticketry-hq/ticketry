"""Post-commit workflow automation at the public state-change seam."""

from __future__ import annotations

import uuid

import pytest
from django.db import transaction
from django.test import override_settings
from ninja.testing import TestClient

from apps.execution import signals as execution_signals
from apps.runs.api import router as runs_router
from apps.runs.models import AutomationAttempt
from worktracker.models import (
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    State,
    Workspace,
)
from worktracker.signals import issue_state_changed


pytestmark = pytest.mark.django_db(transaction=True)
runs_client = TestClient(runs_router)


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
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=after,
        auto_start=auto_start,
        prompt="Review the committed implementation",
        agent="codex",
        model="gpt-5-codex",
        reasoning="high",
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
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
    monkeypatch.setattr(
        "apps.execution.signals.publish_automation_attempt_sync",
        lambda attempt: published.append(attempt),
    )

    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    attempt = AutomationAttempt.objects.get(issue=issue)
    assert issue.state_id == after.id
    assert attempt.status == AutomationAttempt.Status.SUCCEEDED
    assert attempt.agent_run_id == "agent-run-1"
    assert published == [attempt]
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


def test_project_without_typed_workflow_ignores_automation(monkeypatch):
    issue, after = _automation_policy()
    issue.issue_type = None
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
    monkeypatch.setattr(
        "apps.execution.signals.publish_automation_attempt_sync",
        lambda attempt: published.append(attempt),
    )
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])

    issue.refresh_from_db()
    attempt = AutomationAttempt.objects.get(issue=issue)
    assert issue.state_id == after.id
    assert attempt.status == AutomationAttempt.Status.FAILED
    assert attempt.error == "tmux unavailable"
    assert attempt.agent_run_id is None
    assert published == [attempt]


def test_destination_binding_selects_the_automated_launch_configuration(monkeypatch):
    issue, after = _automation_policy()
    LaunchBinding.objects.create(
        issue_type=issue.issue_type,
        state=issue.state,
        prompt="Continue implementation",
        agent="claude",
        model="sonnet",
        reasoning="medium",
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
    LaunchBinding.objects.create(
        issue_type=issue.issue_type,
        state=final,
        auto_start=True,
        prompt="Close the completed work",
        agent="claude",
        model="sonnet",
        reasoning="medium",
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
    issue_state_changed.disconnect(
        dispatch_uid="execution_launch_workflow_automation"
    )
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
def test_failed_attempt_retry_is_user_initiated_and_idempotent(monkeypatch):
    issue, after = _automation_policy()
    launches = []

    async def fail_spawn(**kwargs):
        raise RuntimeError("tmux unavailable")

    monkeypatch.setattr("apps.execution.driver.spawn_run", fail_spawn)
    monkeypatch.setattr(
        "apps.execution.signals.publish_automation_attempt_sync", lambda attempt: None
    )
    issue.state = after
    issue.save(update_fields=["state", "updated_at"])
    failed = AutomationAttempt.objects.get(issue=issue)

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "agent-run-retry"

    monkeypatch.setattr("apps.execution.driver.spawn_run", spawn)
    first = runs_client.post(f"/automation-attempts/{failed.id}/retry")
    second = runs_client.post(f"/automation-attempts/{failed.id}/retry")
    replay_errors = []
    monkeypatch.setattr(
        "apps.execution.signals.logger.exception",
        lambda *args, **kwargs: replay_errors.append(args),
    )
    execution_signals.launch_workflow_automation(
        issue_id=str(issue.id),
        project_id=str(issue.project_id),
        transition_id=str(failed.transition_id),
        from_state_id=str(failed.from_state_id),
        to_state_id=str(failed.to_state_id),
        transition_snapshot={
            "from": str(failed.from_state_id),
            "to": str(failed.to_state_id),
            "auto_start": True,
            "workflow_revision": failed.workflow_revision,
        },
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert first.json() == {
        "attempt_id": first.json()["attempt_id"],
        "root_attempt_id": str(failed.id),
        "retry_of_attempt_id": str(failed.id),
        "work_item_id": str(issue.id),
        "status": "succeeded",
        "error": None,
        "agent_run_id": "agent-run-retry",
        "updated_at": first.json()["updated_at"],
    }
    assert len(launches) == 1
    assert replay_errors == []
    assert AutomationAttempt.objects.filter(issue=issue).count() == 2
    issue.refresh_from_db()
    assert issue.state_id == after.id
