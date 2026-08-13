from __future__ import annotations

import uuid

import pytest
from django.db import connection

from apps.runs.models import AgentRun, AutomationAttempt
from worktracker.models import Issue, IssueType, Project, State, Workspace


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def occurrence_table():
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS worktracker_transitionoccurrence (
                occurrence_id char(32) PRIMARY KEY,
                version integer NOT NULL,
                issue_id char(32) NOT NULL,
                project_id char(32) NOT NULL,
                issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL,
                to_state_id char(32) NOT NULL,
                from_group varchar(32) NOT NULL,
                to_group varchar(32) NOT NULL,
                work_item_revision bigint NOT NULL,
                workflow_revision integer NOT NULL,
                destination_auto_start bool NOT NULL,
                committed_at datetime NOT NULL
            )
            """
        )
        cursor.execute("DELETE FROM worktracker_transitionoccurrence")


def _issue() -> tuple[Issue, State, State]:
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug=f"occ-{uuid.uuid4().hex[:8]}", name="Occurrence"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Occurrence", slug="OCC"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        workflow_revision=9,
    )
    before = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    after = State.objects.create(
        id=uuid.uuid4(), project=project, name="Review", group="started"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
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
        state=after,
        name="Occurrence seam",
        sequence_id=2,
    )
    return issue, before, after


def _append_occurrence(
    issue: Issue,
    before: State,
    after: State,
    *,
    occurrence_id: uuid.UUID | None = None,
    auto_start: bool = True,
) -> uuid.UUID:
    occurrence_id = occurrence_id or uuid.uuid4()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO worktracker_transitionoccurrence (
                occurrence_id, version, issue_id, project_id, issue_type_id,
                from_state_id, to_state_id, from_group, to_group,
                work_item_revision, workflow_revision, destination_auto_start,
                committed_at
            ) VALUES (%s, 1, %s, %s, %s, %s, %s, %s, %s, 8, 9, %s,
                      CURRENT_TIMESTAMP)
            """,
            [
                occurrence_id.hex,
                issue.id.hex,
                issue.project_id.hex,
                issue.issue_type_id.hex,
                before.id.hex,
                after.id.hex,
                before.group,
                after.group,
                auto_start,
            ],
        )
    return occurrence_id


def _succeed(attempt: AutomationAttempt, launches: list[str]) -> None:
    assert AutomationAttempt.objects.filter(pk=attempt.pk).exists()
    launches.append(str(attempt.agent_run_id))
    attempt.status = AutomationAttempt.Status.SUCCEEDED
    attempt.retryable = False
    attempt.save(update_fields=["status", "retryable", "updated_at"])


def test_backlog_reconciliation_materializes_before_launch_and_deduplicates():
    from apps.execution.transition_occurrences import reconcile_pending_occurrences

    issue, before, after = _issue()
    occurrence_id = _append_occurrence(issue, before, after)
    launches: list[str] = []

    reconcile_pending_occurrences(
        launch_attempt=lambda attempt: _succeed(attempt, launches)
    )
    reconcile_pending_occurrences(
        launch_attempt=lambda attempt: _succeed(attempt, launches)
    )

    attempt = AutomationAttempt.objects.get(transition_id=occurrence_id)
    assert attempt.status == AutomationAttempt.Status.SUCCEEDED
    assert attempt.agent_run_id == occurrence_id.hex
    assert launches == [occurrence_id.hex]


def test_restart_adopts_pending_attempt_created_before_launch():
    from apps.execution.transition_occurrences import reconcile_pending_occurrences

    issue, before, after = _issue()
    occurrence_id = _append_occurrence(issue, before, after)
    AutomationAttempt.objects.create(
        transition_id=occurrence_id,
        issue=issue,
        from_state_id=before.id,
        to_state_id=after.id,
        workflow_revision=9,
        agent_run_id=occurrence_id.hex,
    )
    launches: list[str] = []

    reconcile_pending_occurrences(
        launch_attempt=lambda attempt: _succeed(attempt, launches)
    )

    assert launches == [occurrence_id.hex]
    assert (
        AutomationAttempt.objects.get(transition_id=occurrence_id).status == "succeeded"
    )


def test_restart_adopts_existing_run_created_before_attempt_success_recording():
    from apps.execution.transition_occurrences import reconcile_pending_occurrences

    issue, before, after = _issue()
    occurrence_id = _append_occurrence(issue, before, after)
    AutomationAttempt.objects.create(
        transition_id=occurrence_id,
        issue=issue,
        from_state_id=before.id,
        to_state_id=after.id,
        workflow_revision=9,
        agent_run_id=occurrence_id.hex,
    )
    AgentRun.objects.create(
        id=occurrence_id.hex,
        issue=issue,
        agent="codex",
        status="running",
        started_at="2026-08-12T12:00:00+00:00",
        lifecycle_state="starting",
        lifecycle_updated_at="2026-08-12T12:00:00+00:00",
        scope="task",
    )
    launches: list[str] = []

    reconcile_pending_occurrences(
        launch_attempt=lambda attempt: _succeed(attempt, launches)
    )

    attempt = AutomationAttempt.objects.get(transition_id=occurrence_id)
    assert attempt.status == AutomationAttempt.Status.SUCCEEDED
    assert launches == [occurrence_id.hex]
    assert AgentRun.objects.filter(id=occurrence_id.hex).count() == 1


def test_non_auto_start_occurrence_is_durably_inert():
    from apps.execution.transition_occurrences import reconcile_pending_occurrences

    issue, before, after = _issue()
    _append_occurrence(issue, before, after, auto_start=False)

    reconcile_pending_occurrences(
        launch_attempt=lambda attempt: pytest.fail("inert occurrence launched")
    )

    assert not AutomationAttempt.objects.exists()
