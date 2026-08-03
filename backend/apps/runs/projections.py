from __future__ import annotations

from django.core.exceptions import ValidationError

from apps.runs.models import AutomationAttempt
from studio_server.contracts import (
    AutomationAttemptRecord,
    WorkItemState,
    WorkItemStateFrame,
)
from worktracker.models import Issue, Project, State
from worktracker.state import workflow_state_projection


def automation_attempt_record(attempt: AutomationAttempt) -> AutomationAttemptRecord:
    """Project one durable automation attempt into its public status contract."""

    root_id = attempt.root_attempt_id or attempt.id
    return AutomationAttemptRecord(
        attempt_id=str(attempt.id),
        root_attempt_id=str(root_id),
        retry_of_attempt_id=(str(attempt.retry_of_id) if attempt.retry_of_id else None),
        work_item_id=str(attempt.issue_id),
        status=attempt.status,
        error=attempt.error,
        agent_run_id=attempt.agent_run_id,
        updated_at=attempt.updated_at.isoformat(),
    )


def work_item_state_frame(
    *, project_id: str, work_item_id: str, state, revision: int, updated_at: str
) -> WorkItemStateFrame:
    """Project one frozen WorkItem state into the socket contract."""

    return WorkItemStateFrame(
        project_id=project_id,
        work_item_id=work_item_id,
        state=(
            WorkItemState(**workflow_state_projection(state))
            if state is not None
            else None
        ),
        revision=revision,
        updated_at=updated_at,
    )


def project_workflow_states(project_id: str) -> list[WorkItemState]:
    """Project the current authoritative workflow-state catalog."""

    try:
        states = State.objects.filter(project_id=project_id).order_by(
            "sort_order", "created_at"
        )
        return [
            WorkItemState(**workflow_state_projection(state))
            for state in states
        ]
    except (ValidationError, ValueError):
        return []


def project_work_item_replay(
    project_id: str, cursor: int | None
) -> tuple[int, list[WorkItemStateFrame]]:
    """Capture a cursor and latest-per-item projections through that cursor."""

    try:
        upper = Project.objects.values_list("state_revision", flat=True).get(
            pk=project_id
        )
    except (Project.DoesNotExist, ValidationError, ValueError):
        return 0, []
    if cursor is None:
        return upper, []

    issues = (
        Issue.objects.filter(
            project_id=project_id,
            state_revision__gt=cursor,
            state_revision__lte=upper,
        )
        .select_related("state")
        .order_by("state_revision", "id")
    )
    return upper, [
        work_item_state_frame(
            project_id=str(issue.project_id),
            work_item_id=str(issue.pk),
            state=issue.state,
            revision=issue.state_revision,
            updated_at=issue.updated_at.isoformat(),
        )
        for issue in issues
    ]
