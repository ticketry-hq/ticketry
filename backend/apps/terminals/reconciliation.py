"""Application policy for reconciling recorded runs with terminal facts."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from django.db import close_old_connections

from apps.documents import watch as documents_watch
from apps.runs.bus import publish_backend_session_sync
from apps.terminals.agents.registry import (
    cleanup_temporary_artifacts_for_run,
    reconcile_temporary_artifacts,
)
from apps.terminals.models import AgentTerminalSession
from apps.terminals.persistence import persist_reconciliation_outcome
from apps.terminals.runtime import (
    TerminalObservationError,
    TerminalRuntime,
    TerminalRuntimeError,
    TerminalState,
)


logger = logging.getLogger(__name__)


@dataclass
class ReconcileResult:
    """Application outcomes from one reconciliation pass.

    ``soft_deleted`` is retained as the persisted/API compatibility name for
    missing runtimes.
    """

    soft_deleted: list[str] = field(default_factory=list)
    exited: list[str] = field(default_factory=list)
    running: list[str] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)
    persistence_failed: list[str] = field(default_factory=list)
    untracked: list[str] = field(default_factory=list)
    inventory_available: bool = True


class TerminalReconciler:
    """Interpret public terminal observations using application policy."""

    def __init__(self, runtime: TerminalRuntime) -> None:
        self._runtime = runtime

    def reconcile(self) -> ReconcileResult:
        result = ReconcileResult()
        try:
            agent_run_ids = list(
                AgentTerminalSession.objects.filter(terminated_at__isnull=True)
                .order_by("created_at", "agent_run_id")
                .values_list("agent_run_id", flat=True)
            )
        finally:
            close_old_connections()

        for agent_run_id in agent_run_ids:
            try:
                observation = self._runtime.inspect(agent_run_id)
            except (TerminalObservationError, TerminalRuntimeError):
                logger.warning(
                    "terminal observation unavailable agent_run_id=%s",
                    agent_run_id,
                    exc_info=True,
                )
                result.unavailable.append(agent_run_id)
                continue

            if observation.state is TerminalState.RUNNING:
                result.running.append(agent_run_id)
                continue

            ended_at = datetime.now(timezone.utc).isoformat()
            exit_code = (
                observation.exit_code
                if observation.state is TerminalState.EXITED
                else None
            )
            try:
                persisted = persist_reconciliation_outcome(
                    agent_run_id,
                    ended_at=ended_at,
                    exit_code=exit_code,
                )
            except Exception:
                # A retained dead pane remains observable because explicit
                # cleanup is strictly after the durable application write.
                logger.exception(
                    "terminal reconciliation persistence failed agent_run_id=%s",
                    agent_run_id,
                )
                result.persistence_failed.append(agent_run_id)
                continue

            if not persisted.was_active:
                continue

            if observation.state is TerminalState.EXITED:
                result.exited.append(agent_run_id)
                try:
                    self._runtime.terminate(agent_run_id)
                except TerminalRuntimeError:
                    # Persistence is already authoritative. A failed cleanup
                    # is diagnostic and must not roll the recorded outcome back.
                    logger.warning(
                        "retained terminal cleanup failed agent_run_id=%s",
                        agent_run_id,
                        exc_info=True,
                    )
                event = "exited"
            else:
                result.soft_deleted.append(agent_run_id)
                event = "lost"

            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            if persisted.project_id:
                publish_backend_session_sync(
                    persisted.project_id,
                    agent_run_id,
                    event,
                    at=ended_at,
                )

        try:
            active_run_ids = set(
                AgentTerminalSession.objects.filter(terminated_at__isnull=True)
                .values_list("agent_run_id", flat=True)
            )
            reconcile_temporary_artifacts(active_run_ids)
        finally:
            close_old_connections()
        return result


def reconcile_terminals() -> ReconcileResult:
    """Run application reconciliation against the configured public runtime."""

    from apps.terminals.launch import terminal_runtime

    return TerminalReconciler(terminal_runtime).reconcile()
