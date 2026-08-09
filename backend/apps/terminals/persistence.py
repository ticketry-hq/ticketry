"""Application-owned persistence for durable terminal launches.

The terminal runtime deliberately knows nothing about Django records.  This
module owns the existing AgentRun and AgentTerminalSession mirror as one
application transaction and provides the compensation/lifecycle writes used
by launch and explicit cleanup.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import close_old_connections, transaction

from apps.runs.models import AgentRun
from apps.terminals.dao.constants import SCRATCH_TASK_ID
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue


@dataclass(frozen=True)
class LaunchRecords:
    agent_run_id: str
    issue_id: str
    agent: str
    started_at: str
    cwd: str
    design_dir: str | None
    resumed_from: str | None
    scope: str
    doc_rel_path: str | None
    provider_session_id: str | None = None


@dataclass(frozen=True)
class ResumeLaunchFacts:
    """Historical application facts needed to prepare a provider resume."""

    issue_id: str
    agent: str
    ended_at: str | None
    provider_session_id: str | None
    cwd: str | None
    design_dir: str | None
    scope: str


@dataclass(frozen=True)
class LaunchRouting:
    project_id: str
    module_id: str
    task_id: str | None


@dataclass(frozen=True)
class TerminationContext:
    was_active: bool
    project_id: str | None


@dataclass(frozen=True)
class ReconciliationOutcome:
    """Application facts recorded for one dead terminal runtime."""

    project_id: str | None
    was_active: bool


def persist_launch(records: LaunchRecords) -> LaunchRouting:
    """Insert the run and terminal mirror before runtime creation.

    The legacy ``tmux_session_name`` column is retained without a schema
    migration, but stores only the public run handle. Internal runtime names
    are never derived or persisted by the application.
    """

    try:
        issue = Issue.objects.only("id", "project_id", "module_id").get(
            id=records.issue_id
        )
        project_id = str(issue.project_id)
        module_id = str(issue.module_id or issue.id)
        task_id = str(issue.id) if issue.module_id else None
        with transaction.atomic():
            AgentRun.objects.create(
                id=records.agent_run_id,
                issue_id=records.issue_id,
                agent=records.agent,
                status="running",
                started_at=records.started_at,
                lifecycle_state="starting",
                lifecycle_updated_at=records.started_at,
                cwd=records.cwd,
                design_dir=records.design_dir,
                resumed_from=records.resumed_from,
                provider_session_id=records.provider_session_id,
                scope=records.scope,
            )
            AgentTerminalSession.objects.create(
                agent_run_id=records.agent_run_id,
                # Legacy non-null column; no private tmux name crosses the
                # runtime boundary.
                tmux_session_name=records.agent_run_id,
                task_id=task_id or SCRATCH_TASK_ID,
                module_id=module_id,
                project_id=project_id,
                agent=records.agent,
                created_at=records.started_at,
                scope=records.scope,
                doc_rel_path=records.doc_rel_path,
            )
        return LaunchRouting(project_id, module_id, task_id)
    finally:
        close_old_connections()


def load_resume_launch(agent_run_id: str) -> ResumeLaunchFacts | None:
    """Load provider-resume inputs without exposing an ORM row to launch policy."""

    try:
        row = (
            AgentRun.objects.filter(id=agent_run_id)
            .values(
                "issue_id",
                "agent",
                "ended_at",
                "provider_session_id",
                "cwd",
                "design_dir",
                "scope",
            )
            .first()
        )
        if row is None:
            return None
        return ResumeLaunchFacts(
            issue_id=str(row["issue_id"]),
            agent=row["agent"],
            ended_at=row["ended_at"],
            provider_session_id=row["provider_session_id"],
            cwd=row["cwd"],
            design_dir=row["design_dir"],
            scope=row["scope"],
        )
    finally:
        close_old_connections()


def compensate_launch(agent_run_id: str) -> None:
    """Remove all application records for a runtime that failed to launch."""

    try:
        AgentRun.objects.filter(id=agent_run_id).delete()
    finally:
        close_old_connections()


def termination_context(agent_run_id: str) -> TerminationContext:
    """Read the application facts needed for an explicit cleanup."""

    try:
        project_id = (
            AgentRun.objects.filter(id=agent_run_id)
            .values_list("issue__project_id", flat=True)
            .first()
        )
        active = (
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).exists()
            or AgentRun.objects.filter(
                id=agent_run_id, ended_at__isnull=True
            ).exists()
        )
        return TerminationContext(
            was_active=active,
            project_id=str(project_id) if project_id else None,
        )
    finally:
        close_old_connections()


def persist_termination(agent_run_id: str, *, ended_at: str) -> None:
    """Durably mark both existing application records as terminated."""

    try:
        with transaction.atomic():
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=ended_at)
            AgentRun.objects.filter(
                id=agent_run_id, ended_at__isnull=True
            ).update(
                status="terminated",
                ended_at=ended_at,
                lifecycle_state="exited",
                lifecycle_updated_at=ended_at,
            )
    finally:
        close_old_connections()


def persist_reconciliation_outcome(
    agent_run_id: str,
    *,
    ended_at: str,
    exit_code: int | None,
) -> ReconciliationOutcome:
    """Durably classify a runtime observation before runtime cleanup.

    A missing runtime supplies ``exit_code=None`` and therefore does not
    overwrite any previously recorded process result. Hosted-command exit may
    supply the mechanical code reported by the terminal runtime.
    """

    try:
        with transaction.atomic():
            run = (
                AgentRun.objects.select_for_update()
                .select_related("issue")
                .filter(id=agent_run_id)
                .first()
            )
            if run is None:
                return ReconciliationOutcome(project_id=None, was_active=False)

            terminal_updated = AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=ended_at)
            run_updated = 0
            if run.ended_at is None:
                updates = {
                    "status": "exited",
                    "ended_at": ended_at,
                    "lifecycle_state": "exited",
                    "lifecycle_updated_at": ended_at,
                }
                if exit_code is not None:
                    updates["exit_code"] = exit_code
                run_updated = AgentRun.objects.filter(
                    id=agent_run_id,
                    ended_at__isnull=True,
                ).update(**updates)
            return ReconciliationOutcome(
                project_id=str(run.issue.project_id),
                was_active=bool(terminal_updated or run_updated),
            )
    finally:
        close_old_connections()
