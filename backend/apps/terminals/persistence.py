"""Terminal-owned persistence for durable launches, after the Runs handoff.

The terminal runtime deliberately knows nothing about Django records. What
changed at the Slice 3 handoff is who owns which record: every Agent Run,
Launch Effect, and Status Event write is a Rust command reached through
:mod:`apps.runs.rust_port`, while this module keeps only the terminal mirror
and the launch request that hold this capability's own execution material.

The ordering is the point. A launch is prepared durably in Rust before any
runtime exists, the runtime is created second, and its outcome is recorded
durably third. Within preparation itself the terminals-owned launch request is
written before the Rust effect, so a crash across that boundary can only orphan
an inert row and never a durable effect the executor could not perform. A
failure whose cleanup could not be proven leaves the effect cleanup-pending
rather than deleting rows an external runtime may still match.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Mapping

from django.db import close_old_connections, transaction

from apps.runs import rust_port
from apps.runs.models import AgentRun
from apps.terminals.dao.constants import SCRATCH_TASK_ID
from apps.terminals.models import AgentTerminalSession, TerminalLaunchRequest
from apps.terminals.termination_seam import publish_agent_run_terminated
from worktracker.models import Issue


@dataclass(frozen=True)
class LaunchRecords:
    agent_run_id: str
    issue_id: str
    agent: str | None
    started_at: str
    cwd: str
    design_dir: str | None
    resumed_from: str | None
    scope: str
    doc_rel_path: str | None
    runtime_namespace: str
    provider_session_id: str | None = None
    model: str | None = None
    reasoning: str | None = None


@dataclass(frozen=True)
class ResumeLaunchFacts:
    """Historical application facts needed to prepare a provider resume."""

    issue_id: str
    agent: str
    model: str | None
    reasoning: str | None
    ended_at: str | None
    provider_session_id: str | None
    cwd: str | None
    design_dir: str | None
    scope: str


#: Stable namespace for deriving a Launch Effect identity from a run identity.
_LAUNCH_EFFECT_NAMESPACE = uuid.UUID("6f1a7c62-3f2d-4a0e-9f9a-1a2b3c4d5e6f")


@dataclass(frozen=True)
class PreparedCommand:
    """This capability's own execution material for one prepared launch."""

    command: str
    environment: Mapping[str, str]
    columns: int
    rows: int


@dataclass(frozen=True)
class LaunchRouting:
    project_id: str
    module_id: str
    task_id: str | None


@dataclass(frozen=True)
class PreparedLaunch:
    """What a durable preparation leaves behind for the executor step."""

    effect_id: str
    routing: LaunchRouting
    reused: bool


@dataclass(frozen=True)
class TerminationContext:
    was_active: bool
    project_id: str | None


@dataclass(frozen=True)
class ReconciliationOutcome:
    """Application facts recorded for one dead terminal runtime."""

    project_id: str | None
    was_active: bool


@dataclass(frozen=True)
class RuntimeRecoveryOutcome:
    """Application facts restored for a terminal proven to still be live."""

    project_id: str | None
    recovered: bool


def launch_effect_id(agent_run_id: str) -> str:
    """Derive one stable Launch Effect identity from a minted run identity.

    Deriving rather than minting is what makes a repeated launch request
    idempotent: the same run identity always names the same durable effect, so
    a transport retry reuses it instead of preparing a second one.
    """

    return uuid.uuid5(_LAUNCH_EFFECT_NAMESPACE, agent_run_id).hex


def _launch_routing(records: LaunchRecords) -> tuple[LaunchRouting, Issue]:
    issue = Issue.objects.only("id", "project_id", "module_id").get(id=records.issue_id)
    return (
        LaunchRouting(
            project_id=str(issue.project_id),
            module_id=str(issue.module_id or issue.id),
            task_id=str(issue.id) if issue.module_id else None,
        ),
        issue,
    )


def prepare_launch(records: LaunchRecords, command: PreparedCommand) -> PreparedLaunch:
    """Retain this capability's material, then make the launch durable in Rust.

    Rust persists the Agent Run, immutable launch intent, prepared Launch
    Effect, initial lifecycle fact, and status event in one transaction. The
    command, working directory, and environment stay here, in a terminals-owned
    row, because the durable intent deliberately carries no executable data.

    These are two transactions across an ownership boundary, so one of them
    will sometimes be the only one that commits. The order chosen here decides
    which orphan a crash can leave, and only one of the two is survivable. A
    launch request with no effect is inert: nothing reads it, reconciliation
    never sees it, and the next preparation for the same run identity
    overwrites it in place. An effect with no launch request is fatal: the
    effect is durable, reconciliation observes an absent runtime, executes it
    again, and the executor can only answer ``launch_request_unavailable`` —
    a permanent failure for a launch that never started. The launch request is
    therefore written first, keyed by the effect identity that
    :func:`launch_effect_id` derives deterministically from the run identity,
    so it can be written before the effect it belongs to exists.
    """

    try:
        routing, _ = _launch_routing(records)
        effect_id = launch_effect_id(records.agent_run_id)
        TerminalLaunchRequest.objects.update_or_create(
            effect_id=effect_id,
            defaults={
                "agent_run_id": records.agent_run_id,
                "issue_id": records.issue_id,
                "project_id": routing.project_id,
                "module_id": routing.module_id,
                "task_id": routing.task_id or SCRATCH_TASK_ID,
                "agent": records.agent,
                "scope": records.scope,
                "doc_rel_path": records.doc_rel_path,
                "command": command.command,
                "working_directory": str(records.cwd),
                "environment": dict(command.environment),
                "columns": command.columns,
                "rows": command.rows,
                "created_at": records.started_at,
            },
        )
        prepared = rust_port.prepare_launch(
            {
                "effectId": effect_id,
                "agentRunId": records.agent_run_id,
                "requestId": records.agent_run_id,
                "projectId": routing.project_id,
                "issueId": records.issue_id,
                "scope": records.scope,
                "provider": records.agent,
                "targetKind": "work_item",
                "targetId": records.issue_id,
            },
            {
                "model": records.model,
                "reasoning": records.reasoning,
                "cwd": str(records.cwd),
                "design_dir": records.design_dir,
                "resumed_from": records.resumed_from,
                "provider_session_id": records.provider_session_id,
            },
        )
        return PreparedLaunch(
            effect_id=effect_id,
            routing=routing,
            # A reused effect means this exact launch was already durable, so
            # the runtime may already exist and adoption is the success path.
            reused=bool(prepared.get("reused")),
        )
    finally:
        close_old_connections()


def record_terminal_mirror(records: LaunchRecords, routing: LaunchRouting) -> None:
    """Record the terminals-owned mirror once the runtime exists.

    ``agent_terminal_sessions`` is this capability's table, not a Rust-owned
    Runs table, so it is still written here.
    """

    try:
        AgentTerminalSession.objects.update_or_create(
            agent_run_id=records.agent_run_id,
            defaults={
                # Legacy non-null column; no private tmux name crosses the
                # runtime boundary.
                "tmux_session_name": records.agent_run_id,
                "task_id": routing.task_id or SCRATCH_TASK_ID,
                "module_id": routing.module_id,
                "project_id": routing.project_id,
                "agent": records.agent,
                "created_at": records.started_at,
                "last_output_at": records.started_at,
                "terminated_at": None,
                "runtime_namespace": records.runtime_namespace,
                "runtime_cleanup_pending": False,
                "scope": records.scope,
                "doc_rel_path": records.doc_rel_path,
            },
        )
    finally:
        close_old_connections()


def persist_launch(
    records: LaunchRecords,
    *,
    command: str = "test-persisted-launch",
    environment: Mapping[str, str] | None = None,
) -> LaunchRouting:
    """Compatibility seam for new terminal capabilities over Rust ownership.

    Agent Run and launch-effect rows still enter through Rust. Django records
    only its terminal-owned request and mirror.
    """

    prepared = prepare_launch(
        records,
        PreparedCommand(
            command=command,
            environment=environment or {},
            columns=80,
            rows=24,
        ),
    )
    record_terminal_mirror(records, prepared.routing)
    return prepared.routing


def compensate_launch(agent_run_id: str) -> None:
    """Settle a failed prepared launch after runtime cleanup was confirmed."""

    effect_id = launch_effect_id(agent_run_id)
    settle_launch(
        effect_id,
        applied=False,
        code="terminal_runtime_unavailable",
        retryable=True,
        cleanup_confirmed=True,
    )
    discard_launch_request(effect_id)


def mark_launch_cleanup_pending(agent_run_id: str) -> None:
    """Retain a failed effect until runtime cleanup can be proven."""

    settle_launch(
        launch_effect_id(agent_run_id),
        applied=False,
        code="terminal_runtime_unavailable",
        retryable=True,
        cleanup_confirmed=False,
    )


def settle_launch(
    effect_id: str,
    *,
    applied: bool,
    runtime_id: str | None = None,
    adopted: bool = False,
    code: str | None = None,
    retryable: bool = False,
    cleanup_confirmed: bool = False,
) -> None:
    """Record the durable outcome of one prepared effect in Rust."""

    rust_port.settle_launch(
        effect_id,
        applied=applied,
        runtime_id=runtime_id,
        adopted=adopted,
        code=code,
        message=(
            "The terminal runtime was created."
            if applied
            else "The terminal runtime could not be created."
        ),
        retryable=retryable,
        cleanup_confirmed=cleanup_confirmed,
    )


def load_resume_launch(agent_run_id: str) -> ResumeLaunchFacts | None:
    """Load provider-resume inputs without exposing an ORM row to launch policy."""

    try:
        row = (
            AgentRun.objects.filter(id=agent_run_id)
            .values(
                "issue_id",
                "agent",
                "model",
                "reasoning",
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
            model=row["model"],
            reasoning=row["reasoning"],
            ended_at=row["ended_at"],
            provider_session_id=row["provider_session_id"],
            cwd=row["cwd"],
            design_dir=row["design_dir"],
            scope=row["scope"],
        )
    finally:
        close_old_connections()


def discard_launch_request(effect_id: str) -> None:
    """Drop this capability's execution material for a settled failed effect.

    The Rust rows are not touched: only Rust may delete them, and it keeps a
    failed effect exactly as long as its reconciliation needs it.
    """

    try:
        TerminalLaunchRequest.objects.filter(effect_id=effect_id).delete()
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
    """Close the terminal mirror, then record the durable terminal outcome.

    Rust owns the Agent Run, so the explicit terminal fact is its command. The
    mirror is closed first because it is this capability's own row and a failed
    ingress must leave a retryable, not a half-open, terminal.
    """

    try:
        with transaction.atomic():
            terminal_updated = AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=ended_at)
    finally:
        close_old_connections()
    accepted = rust_port.record_terminal_outcome(
        agent_run_id, "terminated", ended_at
    )
    if terminal_updated or accepted.get("applied"):
        publish_agent_run_terminated(agent_run_id)


def persist_reconciliation_outcome(
    agent_run_id: str,
    *,
    ended_at: str,
    exit_code: int | None,
    runtime_namespace: str,
    runtime_cleanup_pending: bool = False,
) -> ReconciliationOutcome:
    """Classify one dead runtime, then record its durable terminal outcome.

    A missing runtime is ``lost`` and supplies no exit code, so it cannot
    overwrite a previously recorded process result. A hosted-command exit is
    ``exited`` and may carry the mechanical code the runtime reported.
    """

    try:
        project_id = (
            AgentRun.objects.filter(id=agent_run_id)
            .values_list("issue__project_id", flat=True)
            .first()
        )
        if project_id is None:
            return ReconciliationOutcome(project_id=None, was_active=False)
        with transaction.atomic():
            terminal_updated = AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
                runtime_namespace=runtime_namespace,
            ).update(
                terminated_at=ended_at,
                runtime_cleanup_pending=runtime_cleanup_pending,
            )
    finally:
        close_old_connections()
    if not terminal_updated:
        return ReconciliationOutcome(project_id=str(project_id), was_active=False)
    accepted = rust_port.record_terminal_outcome(
        agent_run_id,
        "exited" if exit_code is not None else "lost",
        ended_at,
        exit_code=exit_code,
    )
    if accepted.get("applied"):
        publish_agent_run_terminated(agent_run_id)
    return ReconciliationOutcome(project_id=str(project_id), was_active=True)


def persist_runtime_recovery(
    agent_run_id: str,
    *,
    recovered_at: str,
    runtime_namespace: str,
    owned_namespaces: tuple[str, ...],
) -> RuntimeRecoveryOutcome:
    """Repair the terminal mirror after its runtime is observed live again.

    Only the mirror is repaired. An ended Agent Run is terminal authority under
    the Slice 3 contract and is never regressed: a run whose durable outcome
    said it ended stays ended even if a runtime later answers, because the
    alternative is a dead session presented as active.
    """

    try:
        if not owned_namespaces:
            return RuntimeRecoveryOutcome(project_id=None, recovered=False)
        project_id = (
            AgentRun.objects.filter(id=agent_run_id, ended_at__isnull=False)
            .values_list("issue__project_id", flat=True)
            .first()
        )
        if project_id is None:
            return RuntimeRecoveryOutcome(project_id=None, recovered=False)
        with transaction.atomic():
            terminal_updated = AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=False,
                runtime_cleanup_pending=False,
                runtime_namespace__in=owned_namespaces,
            ).update(
                terminated_at=None,
                runtime_namespace=runtime_namespace,
            )
        return RuntimeRecoveryOutcome(
            project_id=str(project_id),
            recovered=bool(terminal_updated),
        )
    finally:
        close_old_connections()
