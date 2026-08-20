"""Transport-independent operations for a module's durable login shells (#666).

Creating, listing and restoring shells lives here rather than in
:mod:`apps.terminals.api`, whose vocabulary is agent runs and whose listings
carry agent-run selection rules that must not shift underneath this surface.

Ending a shell is deliberately *not* re-implemented: a shell run terminates
through the same ``DELETE /api/terminals`` operation as any other durable run,
because ending a run has never depended on what the run was hosting.
"""

from __future__ import annotations

from typing import Any

from asgiref.sync import async_to_sync
from apps.errors import ApplicationError
from apps.terminals import dao
import apps.terminals.launch as terminal_launch
from apps.terminals.durable_launch import LaunchUnavailable
from apps.terminals.reconciliation_scheduler import (
    schedule_terminal_reconciliation,
)
from apps.terminals.shell_launch import ShellLaunchRefused, launch_module_shell


def _module_shell_payload(session) -> dict[str, Any]:
    """Return API-safe metadata for one restorable shell."""

    return {
        "agent_run_id": session.agent_run_id,
        "module_id": session.module_id,
        "created_at": session.created_at,
    }


def create_module_shell(*, module_id: str) -> dict[str, Any]:
    """Create a durable shell run and its terminal for one module."""

    try:
        agent_run_id = async_to_sync(launch_module_shell)(module_id)
    except ShellLaunchRefused as exc:
        # 409 rather than 400: the request is well-formed, and the remedy is to
        # give the module a folder rather than to correct the call.
        raise ApplicationError(409, exc.reason, code=exc.reason) from exc
    except LaunchUnavailable as exc:
        raise ApplicationError(500, str(exc), code="launch_unavailable") from exc

    return {"agent_run_id": agent_run_id}


def list_module_shells(module_id: str) -> list[dict[str, Any]]:
    """List a module's live shells so a reopened surface can restore them."""

    sessions = async_to_sync(dao.list_shell_terminal_sessions)(
        module_id,
        runtime_namespace=terminal_launch.terminal_runtime.namespace,
    )
    payload = [_module_shell_payload(session) for session in sessions]
    schedule_terminal_reconciliation()
    return payload
