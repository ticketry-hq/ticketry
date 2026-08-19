from __future__ import annotations

import logging

from django.dispatch import receiver

from worktracker.signals import issue_state_changed

from apps.execution import auto_start_suppression
from apps.execution import driver
from apps.runs import rust_port
from apps.runs.models import AutomationAttempt
from apps.terminals.launch_configuration import resolve_task_launch_configuration
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.termination_seam import agent_run_terminated
from worktracker.models import Issue

logger = logging.getLogger(__name__)


def _predetermined_agent_run_id(attempt: AutomationAttempt) -> str:
    """Name the Agent Run this attempt will launch, before it launches."""

    if attempt.agent_run_id:
        return attempt.agent_run_id
    if attempt.retry_of_id is not None:
        return attempt.id.hex
    return attempt.transition_id.hex


def run_automation_attempt(
    attempt: AutomationAttempt,
    *,
    destination_state_id: str,
    launch_configuration=None,
) -> AutomationAttempt:
    """Run one durable attempt and publish its isolated terminal outcome."""

    try:
        if launch_configuration is None:
            launch_configuration = resolve_task_launch_configuration(
                str(attempt.issue_id), destination_state_id=destination_state_id
            )
        # The Agent Run identity is predetermined before the launch, and the
        # committed transition occurrence is what determines it. Re-delivery of
        # the same occurrence therefore reaches the same run rather than
        # starting a second session. A retry child shares that occurrence but
        # is a second launch of it, so it is predetermined by its own attempt
        # identity — reusing the failed attempt's run identity would collide
        # with the Agent Run and Launch Effect that attempt already minted.
        result = driver.launch_task_agent(
            str(attempt.issue_id),
            agent=None,
            agent_run_id=_predetermined_agent_run_id(attempt),
            launch_configuration=launch_configuration,
        )
    except Exception as exc:
        # Rust owns automation_attempts. Recording the outcome there is what
        # both settles the row and appends the durable status event, so an
        # unresolved failure survives a reconnect and stays retryable.
        rust_port.record_attempt_outcome(
            str(attempt.id),
            succeeded=False,
            error=str(exc) or exc.__class__.__name__,
            failure=(
                exc.as_payload()
                if isinstance(exc, RequiredSkillUnavailable)
                else None
            ),
            retryable=True,
        )
        attempt.refresh_from_db()
        logger.exception("automated launch failed issue=%s", attempt.issue_id)
        return attempt
    rust_port.record_attempt_outcome(
        str(attempt.id),
        succeeded=True,
        agent=result.agent,
        agent_run_id=result.agent_run_id,
    )
    attempt.refresh_from_db()
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
        # Rust owns automation_attempts, and materialization is idempotent by
        # committed occurrence: a re-delivered transition returns the same root
        # attempt rather than starting a second session.
        materialized = rust_port.materialize_attempt(
            occurrence_id=str(transition_id),
            issue_id=str(issue.pk),
            project_id=str(project_id),
            from_state_id=str(from_state_id),
            to_state_id=str(to_state_id),
            workflow_revision=int(transition_snapshot["workflow_revision"]),
        )
        if materialized["status"] != AutomationAttempt.Status.PENDING:
            return
        attempt = AutomationAttempt.objects.get(pk=materialized["attempt_id"])
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
