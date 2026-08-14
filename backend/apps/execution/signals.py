from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from django.dispatch import receiver

from worktracker.signals import issue_state_changed

from apps.execution import auto_start_suppression
from apps.execution import driver
from apps.runs.bus import publish_automation_attempt
from apps.runs.models import AutomationAttempt
from apps.runs.projections import automation_attempt_record
from apps.terminals.launch_configuration import resolve_task_launch_configuration
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.termination_seam import agent_run_terminated
from worktracker.models import Issue

logger = logging.getLogger(__name__)


def publish_automation_attempt_sync(attempt: AutomationAttempt) -> None:
    """Project one saved attempt onto the existing project status feed."""

    async_to_sync(publish_automation_attempt)(
        str(attempt.issue.project_id),
        automation_attempt_record(attempt),
    )


def run_automation_attempt(
    attempt: AutomationAttempt, *, destination_state_id: str
) -> AutomationAttempt:
    """Run one durable attempt and publish its isolated terminal outcome."""

    try:
        launch_configuration = resolve_task_launch_configuration(
            str(attempt.issue_id), destination_state_id=destination_state_id
        )
        result = driver.launch_task_agent(
            str(attempt.issue_id),
            agent=None,
            launch_configuration=launch_configuration,
        )
    except Exception as exc:
        attempt.status = AutomationAttempt.Status.FAILED
        attempt.error = str(exc) or exc.__class__.__name__
        if isinstance(exc, RequiredSkillUnavailable):
            attempt.error_details = exc.as_payload()
            attempt.retryable = True
        else:
            attempt.error_details = None
            attempt.retryable = True
        attempt.save(
            update_fields=[
                "status",
                "error",
                "error_details",
                "retryable",
                "updated_at",
            ]
        )
        publish_automation_attempt_sync(attempt)
        logger.exception("automated launch failed issue=%s", attempt.issue_id)
        return attempt
    attempt.status = AutomationAttempt.Status.SUCCEEDED
    attempt.agent = result.agent
    attempt.agent_run_id = result.agent_run_id
    attempt.error = None
    attempt.error_details = None
    attempt.retryable = False
    attempt.save(
        update_fields=[
            "status",
            "agent",
            "agent_run_id",
            "error",
            "error_details",
            "retryable",
            "updated_at",
        ]
    )
    publish_automation_attempt_sync(attempt)
    return attempt


@receiver(issue_state_changed, dispatch_uid="execution_launch_workflow_automation")
def launch_workflow_automation(
    *,
    issue_id: str,
    project_id: str | None = None,
    transition_id: str | None = None,
    from_state_id: str | None = None,
    to_state_id: str | None = None,
    transition_snapshot: dict | None = None,
    **kwargs,
) -> None:
    """Start configured state-entry automation after commit, isolated from state truth."""

    if not all((project_id, transition_id, from_state_id, to_state_id)):
        return
    auto_start_suppressed = auto_start_suppression.consume(str(issue_id))
    if not (
        transition_snapshot
        and str(transition_snapshot.get("from")) == str(from_state_id)
        and str(transition_snapshot.get("to")) == str(to_state_id)
        and transition_snapshot.get("auto_start") is True
    ):
        return
    if auto_start_suppressed:
        return
    try:
        issue = (
            Issue.objects.select_related("issue_type")
            .filter(pk=issue_id, project_id=project_id, type="task")
            .first()
        )
        if issue is None:
            return
        attempt, created = AutomationAttempt.objects.get_or_create(
            transition_id=transition_id,
            retry_of__isnull=True,
            defaults={
                "issue": issue,
                "from_state_id": from_state_id,
                "to_state_id": to_state_id,
                "workflow_revision": transition_snapshot["workflow_revision"],
            },
        )
        if not created:
            return
        run_automation_attempt(attempt, destination_state_id=to_state_id)
    except Exception:
        logger.exception("workflow automation receiver failed issue=%s", issue_id)


@receiver(issue_state_changed, dispatch_uid="execution_observe_issue_state_changed")
def observe_completion(
    sender,
    issue_id,
    **kwargs,
) -> None:
    """Observe task completion best-effort; never break the WorkTracker save."""

    try:
        driver.observe_issue_state_changed(
            issue_id=str(issue_id),
        )
    except Exception:
        logger.exception("execution observer failed issue=%s", issue_id)


@receiver(
    agent_run_terminated,
    dispatch_uid="execution_observe_agent_run_terminated",
)
def observe_agent_run_completion(
    sender,
    agent_run_id,
    **kwargs,
) -> None:
    """Observe durable agent/terminal termination best-effort.

    The scheduling decision stays in the driver; this receiver only carries the
    lifecycle fact across the app boundary and must never let a scheduling
    failure propagate back into terminal reconciliation.
    """

    try:
        driver.observe_agent_run_terminated(
            agent_run_id=str(agent_run_id),
        )
    except Exception:
        logger.exception(
            "execution observer failed agent_run=%s", agent_run_id
        )
