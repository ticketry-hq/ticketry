"""Transport-independent terminal-session application operations."""

from __future__ import annotations

from typing import Any, Optional

from asgiref.sync import async_to_sync
from django.db import close_old_connections
from pydantic import BaseModel

from apps.errors import ApplicationError
import apps.terminals.agents.registry as registry
import apps.terminals.launch as terminal_launch
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals import dao
from apps.terminals.control_plane import create_terminal_run
from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity import report_native_output
from apps.terminals.launch import (
    LaunchUnavailable,
    ResumeUnavailable,
    resume_provider_conversation,
    terminate_agent_run,
)
from apps.terminals.authorization import (
    RunAuthorizationError,
    verify_run_authorization,
)
from apps.terminals.reconciliation_scheduler import (
    schedule_terminal_reconciliation,
)
from apps.terminals.runtime import TerminalRuntimeError
from apps.terminals.validation import SpawnRequest, _validate_init
from apps.terminals import viewer_leases
from apps.settings_store.config import NoConfigurationSelected
from apps.runs.models import AgentRun
from apps.runs.run_scopes import SHELL_SCOPE


class CreateTerminalRunBody(BaseModel):
    """Transport-independent inputs for one new durable terminal run."""

    agent: str
    project_id: str
    module_id: str
    task_id: Optional[str] = None
    initial_prompt: Optional[str] = None
    is_planning: bool = False
    is_instant: bool = False
    instant_prompt: Optional[str] = None
    is_doc_chat: bool = False
    doc_rel_path: Optional[str] = None
    doc_id: Optional[str] = None


class ViewerLeaseBody(BaseModel):
    agent_run_id: str
    viewer_id: str
    transport: str


class ViewerLeaseReleaseBody(BaseModel):
    agent_run_id: str
    viewer_id: str


class ViewerOutputReportBody(BaseModel):
    """One native viewer's report that its durable session produced output."""

    agent_run_id: str


def _viewer_lease_payload(lease: viewer_leases.ViewerLease) -> dict[str, Any]:
    replaced = None
    if lease.replaced_viewer_id is not None:
        replaced = {
            "viewer_id": lease.replaced_viewer_id,
            "transport": lease.replaced_transport,
        }
    return {
        "agent_run_id": lease.agent_run_id,
        "viewer_id": lease.viewer_id,
        "transport": lease.transport,
        "expires_at": lease.expires_at.isoformat(),
        "replaced": replaced,
    }


def acquire_viewer_lease(body: ViewerLeaseBody):
    """Acquire the durable newest-viewer-wins lease for a terminal run."""

    if body.transport not in {"browser", "desktop"}:
        raise ApplicationError(400, "invalid_transport", code="invalid_transport")
    try:
        lease = viewer_leases.acquire(
            agent_run_id=body.agent_run_id,
            viewer_id=body.viewer_id,
            transport=body.transport,
        )
    except viewer_leases.ViewerLeaseRunNotFound:
        raise ApplicationError(404, "session_not_found", code="session_not_found")
    return _viewer_lease_payload(lease)


def renew_viewer_lease(body: ViewerLeaseReleaseBody):
    """Renew a lease or tell a displaced viewer why it must detach."""

    lease = viewer_leases.renew(
        agent_run_id=body.agent_run_id,
        viewer_id=body.viewer_id,
    )
    if lease is None:
        raise ApplicationError(
            409,
            "replaced_by_another_viewer",
            code="replaced_by_another_viewer",
        )
    return _viewer_lease_payload(lease)


def release_viewer_lease(body: ViewerLeaseReleaseBody):
    """Release only this viewer's lease; never terminate the tmux run."""

    released = viewer_leases.release(
        agent_run_id=body.agent_run_id,
        viewer_id=body.viewer_id,
    )
    return {"released": released}


def report_viewer_output(body: ViewerOutputReportBody):
    """Record one native viewer's output observation for its durable session.

    The native renderer owns its own PTY, so it reports only that output
    happened; the shared activity operation still captures the screen, decides
    whether the output identity changed, and publishes the run projection. An
    unchanged screen — a reconnect or reload redraw — advances nothing.

    This is status telemetry for a terminal the person is watching: an unknown
    run, an ended session, a failed capture, or a failed publication is
    reported as `observed: false` rather than as an error the renderer must
    handle.
    """

    observed = async_to_sync(report_native_output)(body.agent_run_id)
    return {"agent_run_id": body.agent_run_id, "observed": observed}


def _create_request_as_spawn_init(
    body: CreateTerminalRunBody,
) -> tuple[SpawnRequest | None, str | None]:
    """Validate control-plane input with the established spawn contract."""

    # Creation has no viewer geometry. Supply harmless dimensions solely to
    # reuse the exact validation path the legacy WebSocket spawn branch uses.
    return _validate_init(
        {
            "type": "init",
            "mode": "spawn",
            "cols": 1,
            "rows": 1,
            **body.model_dump(),
        }
    )


def _terminal_session_payload(session) -> dict[str, Any]:
    """Return API-safe terminal-session metadata."""

    return {
        "agent_run_id": session.agent_run_id,
        "doc_rel_path": session.doc_rel_path,
        "created_at": session.created_at,
    }


def create_terminal(body: CreateTerminalRunBody):
    """Create a durable run and terminal runtime before a viewer attaches."""

    init, error = _create_request_as_spawn_init(body)
    if error is not None:
        raise ApplicationError(400, error, code=error)

    try:
        agent_run_id = async_to_sync(create_terminal_run)(init)
    except RequiredSkillUnavailable as exc:
        raise ApplicationError(409, exc.message, body=exc.as_payload()) from exc
    except NoConfigurationSelected:
        raise ApplicationError(400, "no_profile_selected", code="no_profile_selected")
    except LaunchUnavailable as exc:
        raise ApplicationError(500, str(exc), code="launch_unavailable") from exc
    except ValueError as exc:
        error = str(exc) or exc.__class__.__name__
        raise ApplicationError(400, error, code=error) from exc

    return {"agent_run_id": agent_run_id}


def _select_resumable_runs(
    terminated_runs: list[AgentRun],
    live_provider_session_ids: set[str],
    live_resumed_from_ids: set[str] = frozenset(),
) -> list[AgentRun]:
    """Return newest resumable runs for one task.

    Rule: keep AgentRun rows for the task where ended_at is set and
    provider_session_id is non-empty; collapse by provider_session_id, keeping
    only the newest row by ended_at; exclude any provider_session_id that is
    also present on a currently-running AgentRun; exclude any run a
    currently-running AgentRun points at via resumed_from (the live successor
    has no provider_session_id until its first hook fires, so the
    provider-session exclusion alone would briefly re-offer the old run).
    """

    selected: dict[str, AgentRun] = {}
    for run in sorted(
        terminated_runs,
        key=lambda row: (row.ended_at or "", row.started_at or "", row.id),
        reverse=True,
    ):
        provider_session_id = run.provider_session_id
        if not provider_session_id or provider_session_id in live_provider_session_ids:
            continue
        if run.id in live_resumed_from_ids:
            continue
        if provider_session_id in selected:
            continue
        selected[provider_session_id] = run
    return list(selected.values())[:10]


def list_terminals(task_id: str) -> list[dict[str, Any]]:
    """List active persisted terminal sessions for a work item."""

    sessions = [
        session
        for session in async_to_sync(dao.list_terminal_sessions_for_task)(
            task_id,
            runtime_namespace=terminal_launch.terminal_runtime.namespace,
        )
        if session.scope != "docchat"
        # A shell run carries the scratch sentinel as its task, so a listing
        # asked for that sentinel would otherwise return one. Shells belong to
        # their own module surface, never to a work item's tab strip (#666).
        and session.scope != SHELL_SCOPE
    ]
    payload = [_terminal_session_payload(s) for s in sessions]
    schedule_terminal_reconciliation()
    return payload


def resume_terminal(agent_run_id: str):
    """Resume a terminated provider conversation in a fresh tmux run."""

    try:
        new_agent_run_id = async_to_sync(resume_provider_conversation)(agent_run_id)
    except ResumeUnavailable as exc:
        status = 404 if exc.reason == "unknown_run" else 409
        raise ApplicationError(status, exc.reason, code=exc.reason) from exc
    except registry.ResumeUnsupported:
        raise ApplicationError(409, "resume_unsupported", code="resume_unsupported")
    except LaunchUnavailable as exc:
        raise ApplicationError(500, str(exc), code="launch_unavailable") from exc
    except registry.UnknownAgent:
        raise ApplicationError(409, "unknown_agent", code="unknown_agent")

    return {
        "agent_run_id": new_agent_run_id,
        "resumed_from": agent_run_id,
    }


def list_resumable_terminals(
    task_id: str | None = None,
    project_id: str | None = None,
    module_id: str | None = None,
) -> list[dict[str, Any]]:
    """List terminated-but-resumable task or module-scoped scratch runs."""

    def _load_resumable_runs() -> list[AgentRun]:
        try:
            if task_id:
                scope = {"issue_id": task_id}
            elif project_id and module_id:
                scope = {
                    "issue_id": module_id,
                    "issue__project_id": project_id,
                }
            else:
                return []
            terminated_query = (
                AgentRun.objects.filter(ended_at__isnull=False, **scope)
                .exclude(scope="docchat")
                # A run with no provider has no conversation to resume, and the
                # resume chip is labelled with the agent it would relaunch. Such
                # a run never reaches here anyway (it carries no
                # provider_session_id), but the exclusion is declared rather
                # than inferred (#665).
                .exclude(scope=SHELL_SCOPE)
            )
            # Scratch history is deliberately limited to the two launch modes
            # rendered in the Scratch workspace. A sentinel-task doc-chat (or
            # any future scratch-only mode) must not consume a resume chip.
            if not task_id:
                terminated_query = terminated_query.filter(
                    scope__in=("plan", "instant"),
                )
            terminated_runs = list(
                terminated_query.exclude(ended_at="")
                .exclude(provider_session_id__isnull=True)
                .exclude(provider_session_id="")
                .order_by("-ended_at", "-started_at", "-id")
            )
            live_provider_session_ids = {
                provider_session_id
                for provider_session_id in AgentRun.objects.filter(
                    ended_at__isnull=True, **scope
                )
                .exclude(scope="docchat")
                .exclude(provider_session_id__isnull=True)
                .exclude(provider_session_id="")
                .values_list("provider_session_id", flat=True)
            }
            live_resumed_from_ids = {
                resumed_from
                for resumed_from in AgentRun.objects.filter(
                    ended_at__isnull=True, **scope
                )
                .exclude(scope="docchat")
                .exclude(resumed_from__isnull=True)
                .exclude(resumed_from="")
                .values_list("resumed_from", flat=True)
            }
            return _select_resumable_runs(
                terminated_runs,
                live_provider_session_ids,
                live_resumed_from_ids,
            )
        finally:
            close_old_connections()

    runs = _load_resumable_runs()
    return [
        {
            "agent_run_id": run.id,
            "agent": run.agent,
            "status": run.status,
            "started_at": run.started_at,
            # The launch snapshot travels with the dormant listing so a resume
            # chip names the phase its conversation began in without waiting
            # for — or being limited by — the status snapshot's recency window
            # (#695). Null stays null: an unrecorded phase is never guessed.
            "launch_state": run.launch_state,
            "launch_model": run.launch_model,
            # A scratch Plan or Instant run records no launch state by design,
            # so its routing scope is the only durable source for the word its
            # resume chip shows (#708). It travels here for the same reason the
            # launch snapshot does.
            "scope": run.scope,
            "provider_session_id": run.provider_session_id,
            "resumed_from": run.resumed_from,
        }
        for run in runs
    ]


def list_scratch_terminals(
    project_id: str,
    module_id: str | None = None,
) -> list[dict[str, Any]]:
    """List active persisted no-task sessions for a project, optionally by module."""

    scratch_sessions = async_to_sync(dao.list_terminal_sessions_for_task)(
        dao.SCRATCH_TASK_ID,
        runtime_namespace=terminal_launch.terminal_runtime.namespace,
    )
    sessions = [
        session
        for session in scratch_sessions
        if session.project_id == project_id
        and session.scope != "docchat"
        # A shell run shares the scratch sentinel task but belongs to its own
        # surface, not the Scratch workspace tab strip (#665).
        and session.scope != SHELL_SCOPE
        and (module_id is None or session.module_id == module_id)
    ]
    payload = [_terminal_session_payload(s) for s in sessions]
    schedule_terminal_reconciliation()
    return payload


def terminate_terminal(agent_run_id: str):
    """Explicitly terminate a runtime and soft-delete its metadata row."""

    try:
        known = AgentTerminalSession.objects.filter(agent_run_id=agent_run_id).exists()
        terminate_agent_run(agent_run_id)
    except TerminalRuntimeError as exc:
        raise ApplicationError(500, str(exc), code="terminate_failed") from exc
    if not known:
        raise ApplicationError(404, "session_not_found", code="session_not_found")

    return {"agent_run_id": agent_run_id, "terminated": True}


def self_terminate_terminal(authorization: str | None):
    """Terminate only the run named by Studio-issued request authorization."""

    try:
        agent_run_id = verify_run_authorization(authorization)
    except RunAuthorizationError as exc:
        raise ApplicationError(401, str(exc), code="caller_run_unbound") from exc

    def _run_state() -> tuple[bool, bool]:
        known = AgentRun.objects.filter(id=agent_run_id).exists()
        active = (
            AgentRun.objects.filter(id=agent_run_id, ended_at__isnull=True).exists()
            or AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).exists()
        )
        return known, active

    known, active = _run_state()
    if not known:
        raise ApplicationError(404, "caller_run_unknown", code="caller_run_unknown")
    try:
        terminate_agent_run(agent_run_id)
    except TerminalRuntimeError as exc:
        raise ApplicationError(500, str(exc), code="terminate_failed") from exc

    return {
        "ok": True,
        "terminated": True,
        "already_terminated": not active,
        "agent_run_id": agent_run_id,
    }


def authorize_mcp_run(authorization: str | None):
    """Resolve one signed MCP caller to its durable WorkTracker scope."""

    try:
        agent_run_id = verify_run_authorization(authorization)
    except RunAuthorizationError as exc:
        raise ApplicationError(401, str(exc), code="caller_run_unbound") from exc

    run = AgentRun.objects.select_related("issue").filter(id=agent_run_id).first()
    if run is None:
        raise ApplicationError(404, "caller_run_unknown", code="caller_run_unknown")
    if run.ended_at is not None:
        raise ApplicationError(401, "caller_run_inactive", code="caller_run_unbound")
    return {
        "agent_run_id": run.id,
        "issue_id": str(run.issue_id),
        "project_id": str(run.issue.project_id),
        "scope": run.scope,
    }
