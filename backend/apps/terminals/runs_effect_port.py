"""The temporary terminal executor behind the Slice 3 Runs handoff.

Rust owns every Runs table. This module is the whole of what Django may still
do about a launch: observe what exists under a deterministic runtime identity,
and create the runtime for one effect Rust has already made durable. It reads
its own terminals-owned launch request; it never writes an Agent Run,
Automation Attempt, Launch Effect, or Status Event row, and it receives no
attempt identity or authority to mint a run.
"""

from __future__ import annotations

import logging

from apps.runs.write_ownership import rust_owns_runs_writes
from apps.terminals.models import AgentTerminalSession, TerminalLaunchRequest
from apps.terminals.runtime import (
    CreateTerminal,
    TerminalAlreadyExists,
    TerminalObservationError,
    TerminalState,
)


logger = logging.getLogger(__name__)

PORT_VERSION = 1


def readiness() -> dict:
    """The exact record Rust requires before it will call this executor."""

    return {
        "version": PORT_VERSION,
        "ready": rust_owns_runs_writes(),
        "runs_owner": "rust",
        "effect_owner": "django",
        # Stated rather than implied: there is no Django Runs writer left to
        # fall back to, so a failed handoff cannot silently downgrade.
        "django_runs_write_fallback": False,
    }


def _runtime():
    """The live runtime seam. Imported lazily so this port stays importable
    without pulling the whole launch module into every consumer."""

    from apps.terminals.launch import terminal_runtime

    return terminal_runtime


def observe(identity: dict) -> dict:
    """Report what exists under one deterministic runtime identity.

    Only three answers permit a decision, and the honest fourth — "I could not
    tell" — is the default. Reconciliation reads ``absent`` as permission to
    execute again, so an unproven answer must never be reported as absent.
    """

    agent_run_id = str(identity.get("agent_run_id") or "")
    if not agent_run_id:
        return {"observation": "uncertain", "detail": "identity_missing"}
    try:
        observation = _runtime().inspect(agent_run_id)
    except TerminalObservationError:
        return {"observation": "uncertain", "detail": "runtime_unobservable"}
    except Exception:
        logger.warning("runs effect observation failed run=%s", agent_run_id, exc_info=True)
        return {"observation": "uncertain", "detail": "runtime_unobservable"}

    if observation.state is TerminalState.MISSING:
        return {"observation": "absent"}
    if observation.state is TerminalState.EXITED:
        # The runtime the effect asked for is gone. Its exit is a terminal fact
        # Rust records through the lifecycle seam, not something to adopt here.
        return {"observation": "absent"}

    mirror = AgentTerminalSession.objects.filter(agent_run_id=agent_run_id).first()
    if mirror is None:
        return {
            "observation": "conflicting",
            "runtime_id": agent_run_id,
            "detail": "runtime_without_terminal_mirror",
        }
    expected_issue = str(identity.get("issue_id") or "")
    request = TerminalLaunchRequest.objects.filter(agent_run_id=agent_run_id).first()
    if request is not None and expected_issue and request.issue_id != expected_issue:
        return {
            "observation": "conflicting",
            "runtime_id": agent_run_id,
            "detail": "runtime_identity_conflict",
        }
    return {"observation": "live", "runtime_id": agent_run_id}


def execute(claim: dict) -> dict:
    """Create the deterministic runtime for one already-durable effect.

    The claim carries exactly the two identities Rust predetermined. Everything
    else — the approved command, working directory, and environment — is read
    from this capability's own durable launch request, so no command line,
    path, or credential ever crosses the ownership boundary.
    """

    effect_id = str(claim.get("effect_id") or "")
    agent_run_id = str(claim.get("agent_run_id") or "")
    if not effect_id or not agent_run_id:
        return {"ok": False, "code": "claim_incomplete", "retryable": False,
                "cleanup_confirmed": True}

    request = TerminalLaunchRequest.objects.filter(
        effect_id=effect_id, agent_run_id=agent_run_id
    ).first()
    if request is None:
        # The effect is durable but its execution material is not. Nothing was
        # started, so cleanup is confirmed and a blind retry is pointless.
        return {"ok": False, "code": "launch_request_unavailable",
                "retryable": False, "cleanup_confirmed": True}

    try:
        adopted = _create_or_adopt(request)
    except Exception as exc:
        logger.exception("terminal effect execution failed run=%s", agent_run_id)
        return {
            "ok": False,
            "code": "terminal_runtime_unavailable",
            "retryable": True,
            # A failed create may have left a partial runtime behind, so
            # cleanup is confirmed only when termination proved it gone.
            "cleanup_confirmed": _cleanup_confirmed(agent_run_id),
            "detail": exc.__class__.__name__,
        }
    _record_terminal_mirror(request)
    return {"ok": True, "runtime_id": agent_run_id, "adopted": adopted}


def _create_or_adopt(request: TerminalLaunchRequest) -> bool:
    """Create the runtime, or adopt the one already holding this identity."""

    try:
        _runtime().create(
            CreateTerminal(
                agent_run_id=request.agent_run_id,
                command=request.command,
                working_directory=request.working_directory,
                environment=dict(request.environment or {}),
                dimensions=request.dimensions_tuple(),
            )
        )
        return False
    except TerminalAlreadyExists:
        # A crash between creation and acknowledgement leaves exactly this
        # state. Adoption is the idempotent success path; a second runtime is
        # never created for one durable effect.
        return True


def _record_terminal_mirror(request: TerminalLaunchRequest) -> None:
    """Record the terminals-owned mirror. This table is not Rust-owned."""

    AgentTerminalSession.objects.update_or_create(
        agent_run_id=request.agent_run_id,
        defaults={
            "tmux_session_name": request.agent_run_id,
            "task_id": request.task_id,
            "module_id": request.module_id,
            "project_id": request.project_id,
            "agent": request.agent,
            "created_at": request.created_at,
            "terminated_at": None,
            "runtime_namespace": _runtime().namespace,
            "runtime_cleanup_pending": False,
            "scope": request.scope,
            "doc_rel_path": request.doc_rel_path,
        },
    )


def _cleanup_confirmed(agent_run_id: str) -> bool:
    try:
        _runtime().terminate(agent_run_id)
        return True
    except Exception:
        logger.warning(
            "terminal effect cleanup unconfirmed run=%s", agent_run_id, exc_info=True
        )
        return False
