"""Terminal-session REST endpoints (list, scratch, counts, resume, terminate)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from django.http import JsonResponse
from django.db import close_old_connections
from ninja import Router
from pydantic import BaseModel

import apps.terminals.agents.registry as registry
from apps.terminals import dao
from apps.terminals.control_plane import create_terminal_run
from apps.terminals.models import AgentTerminalSession
from apps.terminals.launch import LaunchUnavailable
from apps.terminals.authorization import (
    RunAuthorizationError,
    verify_run_authorization,
)
from apps.terminals.session import (
    ResumeUnavailable,
    TerminalSessionError,
    session as terminal_session,
)
from apps.terminals.validation import SpawnRequest, _validate_init
from apps.terminals import viewer_leases
from apps.settings_store.config import NoConfigurationSelected
from apps.runs.models import AgentRun


router = Router(tags=["terminals"])
logger = logging.getLogger(__name__)


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


@router.post("/terminals/viewers/lease")
async def acquire_viewer_lease(request, body: ViewerLeaseBody):
    """Acquire the durable newest-viewer-wins lease for a terminal run."""

    if body.transport not in {"browser", "desktop"}:
        return JsonResponse({"detail": {"error": "invalid_transport"}}, status=400)
    try:
        lease = await asyncio.to_thread(
            viewer_leases.acquire,
            agent_run_id=body.agent_run_id,
            viewer_id=body.viewer_id,
            transport=body.transport,
        )
    except viewer_leases.ViewerLeaseRunNotFound:
        return JsonResponse({"detail": {"error": "session_not_found"}}, status=404)
    return _viewer_lease_payload(lease)


@router.post("/terminals/viewers/lease/renew")
async def renew_viewer_lease(request, body: ViewerLeaseReleaseBody):
    """Renew a lease or tell a displaced viewer why it must detach."""

    lease = await asyncio.to_thread(
        viewer_leases.renew,
        agent_run_id=body.agent_run_id,
        viewer_id=body.viewer_id,
    )
    if lease is None:
        return JsonResponse({"detail": {"error": "replaced_by_another_viewer"}}, status=409)
    return _viewer_lease_payload(lease)


@router.post("/terminals/viewers/lease/release")
async def release_viewer_lease(request, body: ViewerLeaseReleaseBody):
    """Release only this viewer's lease; never terminate the tmux run."""

    released = await asyncio.to_thread(
        viewer_leases.release,
        agent_run_id=body.agent_run_id,
        viewer_id=body.viewer_id,
    )
    return {"released": released}


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
        "tmux_session_name": session.tmux_session_name,
        "task_id": session.task_id,
        "module_id": session.module_id,
        "project_id": session.project_id,
        "agent": session.agent,
        "scope": session.scope,
        "doc_rel_path": session.doc_rel_path,
        "created_at": session.created_at,
        "terminated_at": session.terminated_at,
    }


@router.post("/terminals")
async def create_terminal(request, body: CreateTerminalRunBody):
    """Create a durable run and tmux session before a terminal attaches."""

    init, error = _create_request_as_spawn_init(body)
    if error is not None:
        return JsonResponse({"detail": {"error": error}}, status=400)

    try:
        agent_run_id = await create_terminal_run(init)
    except NoConfigurationSelected:
        return JsonResponse({"detail": {"error": "no_profile_selected"}}, status=400)
    except LaunchUnavailable as exc:
        return JsonResponse(
            {"detail": {"error": "launch_unavailable", "message": str(exc)}},
            status=500,
        )
    except ValueError as exc:
        error = str(exc) or exc.__class__.__name__
        return JsonResponse({"detail": {"error": error}}, status=400)

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


@router.get("/terminals")
async def list_terminals(request, task_id: str) -> list[dict[str, Any]]:
    """List active persisted terminal sessions for a work item."""

    # Reap dead/orphaned tmux sessions first so the UI is never offered a
    # session it can't attach to. Best-effort: a reaper failure degrades to
    # returning the unreconciled list rather than failing the request.

    try:
        await asyncio.to_thread(terminal_session.reconcile)
    except Exception as exc:
        logger.warning("terminal reconcile before list failed: %s", exc)

    sessions = await asyncio.to_thread(terminal_session.sessions_for, task_id)
    return [_terminal_session_payload(s) for s in sessions]


@router.post("/terminals/resume")
async def resume_terminal(request, agent_run_id: str):
    """Resume a terminated provider conversation in a fresh tmux run."""

    try:
        new_agent_run_id = await terminal_session.resume(agent_run_id)
    except ResumeUnavailable as exc:
        status = 404 if exc.reason == "unknown_run" else 409
        return JsonResponse({"detail": {"error": exc.reason}}, status=status)
    except registry.ResumeUnsupported:
        return JsonResponse({"detail": {"error": "resume_unsupported"}}, status=409)
    except LaunchUnavailable as exc:
        return JsonResponse(
            {"detail": {"error": "launch_unavailable", "message": str(exc)}},
            status=500,
        )
    except registry.UnknownAgent:
        return JsonResponse({"detail": {"error": "unknown_agent"}}, status=409)

    return {
        "agent_run_id": new_agent_run_id,
        "resumed_from": agent_run_id,
    }


@router.get("/terminals/resumable")
async def list_resumable_terminals(
    request,
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
            terminated_query = AgentRun.objects.filter(ended_at__isnull=False, **scope)
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
                .exclude(provider_session_id__isnull=True)
                .exclude(provider_session_id="")
                .values_list("provider_session_id", flat=True)
            }
            live_resumed_from_ids = {
                resumed_from
                for resumed_from in AgentRun.objects.filter(
                    ended_at__isnull=True, **scope
                )
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

    runs = await asyncio.to_thread(_load_resumable_runs)
    return [
        {
            "agent_run_id": run.id,
            "agent": run.agent,
            "status": run.status,
            "started_at": run.started_at,
            "ended_at": run.ended_at,
            "provider_session_id": run.provider_session_id,
            "resumed_from": run.resumed_from,
            "scope": run.scope,
        }
        for run in runs
    ]


@router.get("/terminals/scratch")
async def list_scratch_terminals(
    request,
    project_id: str,
    module_id: str | None = None,
) -> list[dict[str, Any]]:
    """List active persisted no-task sessions for a project, optionally by module."""

    # Reap dead/orphaned tmux sessions first, mirroring the task-bound list.

    try:
        await asyncio.to_thread(terminal_session.reconcile)
    except Exception as exc:
        logger.warning("terminal reconcile before scratch list failed: %s", exc)

    scratch_sessions = await asyncio.to_thread(
        terminal_session.sessions_for,
        dao.SCRATCH_TASK_ID,
    )
    sessions = [
        session
        for session in scratch_sessions
        if session.project_id == project_id
        and (module_id is None or session.module_id == module_id)
    ]
    return [_terminal_session_payload(s) for s in sessions]


@router.delete("/terminals/")
async def terminate_terminal(request, agent_run_id: str):
    """Terminate a tmux session and soft-delete its metadata row."""

    try:
        known = await asyncio.to_thread(
            lambda: AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id
            ).exists()
        )
        await asyncio.to_thread(terminal_session.terminate, agent_run_id)
    except TerminalSessionError as exc:
        return JsonResponse(
            {"detail": {"error": "terminate_failed", "message": str(exc)}},
            status=500,
        )
    if not known:
        return JsonResponse(
            {"detail": {"error": "session_not_found"}},
            status=404,
        )

    return {"agent_run_id": agent_run_id, "terminated": True}


@router.post("/terminals/self-terminate")
async def self_terminate_terminal(request):
    """Terminate only the run named by Studio-issued request authorization."""

    try:
        agent_run_id = verify_run_authorization(request.headers.get("Authorization"))
    except RunAuthorizationError as exc:
        return JsonResponse(
            {"ok": False, "error": "caller_run_unbound", "reason": str(exc)},
            status=401,
        )

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

    known, active = await asyncio.to_thread(_run_state)
    if not known:
        return JsonResponse(
            {"ok": False, "error": "caller_run_unknown"},
            status=404,
        )
    if not active:
        return {
            "ok": True,
            "terminated": True,
            "already_terminated": True,
            "agent_run_id": agent_run_id,
        }

    try:
        await asyncio.to_thread(terminal_session.terminate, agent_run_id)
    except TerminalSessionError as exc:
        return JsonResponse(
            {"ok": False, "error": "terminate_failed", "message": str(exc)},
            status=500,
        )

    return {
        "ok": True,
        "terminated": True,
        "already_terminated": False,
        "agent_run_id": agent_run_id,
    }
