"""Application policy for reconciling recorded runs with terminal facts."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from django.db import close_old_connections
from django.db.models import Q

from apps.documents import watch as documents_watch
from apps.runs.bus import publish_backend_session_sync
from apps.terminals.agents.registry import (
    cleanup_temporary_artifacts_for_run,
    reconcile_temporary_artifacts,
)
from apps.terminals.models import AgentTerminalSession
from apps.terminals.persistence import (
    compensate_launch,
    persist_reconciliation_outcome,
    persist_runtime_recovery,
)
from apps.terminals.recovery_status import publish_runtime_recovery
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
    recovered: list[str] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)
    persistence_failed: list[str] = field(default_factory=list)
    untracked: list[str] = field(default_factory=list)
    inventory_available: bool = True


class TerminalReconciler:
    """Interpret public terminal observations using application policy."""

    def __init__(self, runtime: TerminalRuntime) -> None:
        self._runtime = runtime
        self._runtime_namespace = runtime.namespace
        self._legacy_runtime_namespaces = tuple(
            namespace
            for namespace in runtime.legacy_namespaces
            if namespace != self._runtime_namespace
        )

    def reconcile(self) -> ReconcileResult:
        result = ReconcileResult()
        self._claim_observable_legacy_runs()
        self._recover_running_owned_tombstones(result)
        try:
            recorded_runs = list(
                AgentTerminalSession.objects.filter(
                    terminated_at__isnull=True,
                    runtime_namespace=self._runtime_namespace,
                )
                .order_by("created_at", "agent_run_id")
                .values_list("agent_run_id", "agent_run__status")
            )
            cleanup_pending_ids = list(
                AgentTerminalSession.objects.filter(
                    runtime_cleanup_pending=True,
                    runtime_namespace=self._runtime_namespace,
                )
                .order_by("created_at", "agent_run_id")
                .values_list("agent_run_id", flat=True)
            )
        finally:
            close_old_connections()

        for agent_run_id in cleanup_pending_ids:
            self._cleanup_retained_runtime(agent_run_id)

        for agent_run_id, run_status in recorded_runs:
            if run_status == "cleanup_pending":
                try:
                    self._runtime.terminate(agent_run_id)
                except TerminalRuntimeError:
                    logger.warning(
                        "pending launch cleanup unavailable agent_run_id=%s",
                        agent_run_id,
                        exc_info=True,
                    )
                    result.unavailable.append(agent_run_id)
                    continue
                try:
                    compensate_launch(agent_run_id)
                except Exception:
                    logger.exception(
                        "pending launch cleanup persistence failed agent_run_id=%s",
                        agent_run_id,
                    )
                    result.persistence_failed.append(agent_run_id)
                    continue
                cleanup_temporary_artifacts_for_run(agent_run_id)
                continue

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
                    runtime_namespace=self._runtime_namespace,
                    runtime_cleanup_pending=(
                        observation.state is TerminalState.EXITED
                    ),
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
                self._cleanup_retained_runtime(agent_run_id)
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
                    # The hosted command's own result rides with the ending, so
                    # a surface can tell a clean end from a failed one from the
                    # one frame it already reacts to (#670).
                    exit_code=persisted.exit_code,
                )

        try:
            active_run_ids = set(
                AgentTerminalSession.objects.filter(
                    terminated_at__isnull=True,
                    runtime_namespace=self._runtime_namespace,
                )
                .values_list("agent_run_id", flat=True)
            )
            reconcile_temporary_artifacts(active_run_ids)
        finally:
            close_old_connections()
        return result

    def _claim_observable_legacy_runs(self) -> None:
        """Adopt pre-namespace rows only when this runtime proves ownership.

        A missing observation is deliberately inconclusive: the row may belong
        to another profile's socket. Leaving it untouched prevents a foreign
        reconciler from manufacturing a terminal death during migration.
        """

        try:
            legacy_rows = AgentTerminalSession.objects.filter(
                terminated_at__isnull=True,
            ).filter(
                Q(runtime_namespace__isnull=True)
                | Q(runtime_namespace__in=self._legacy_runtime_namespaces)
            )
            legacy_run_ids = list(
                legacy_rows
                .order_by("created_at", "agent_run_id")
                .values_list("agent_run_id", flat=True)
            )
        finally:
            close_old_connections()

        for agent_run_id in legacy_run_ids:
            try:
                observation = self._runtime.inspect(agent_run_id)
            except (TerminalObservationError, TerminalRuntimeError):
                logger.warning(
                    "legacy terminal ownership observation unavailable "
                    "agent_run_id=%s",
                    agent_run_id,
                    exc_info=True,
                )
                continue
            if observation.state is TerminalState.MISSING:
                continue
            try:
                (
                    AgentTerminalSession.objects.filter(
                        agent_run_id=agent_run_id,
                    )
                    .filter(
                        Q(runtime_namespace__isnull=True)
                        | Q(runtime_namespace__in=self._legacy_runtime_namespaces)
                    )
                    .update(runtime_namespace=self._runtime_namespace)
                )
            finally:
                close_old_connections()

    def _recover_running_owned_tombstones(self, result: ReconcileResult) -> None:
        """Heal owned tombstones whose original pane is proven live."""

        owned_namespaces = (
            self._runtime_namespace,
            *self._legacy_runtime_namespaces,
        )
        try:
            candidates = list(
                AgentTerminalSession.objects.filter(
                    terminated_at__isnull=False,
                    runtime_cleanup_pending=False,
                    runtime_namespace__in=owned_namespaces,
                    agent_run__ended_at__isnull=False,
                )
                .order_by("-created_at", "agent_run_id")
                .values_list("agent_run_id", flat=True)
            )
        finally:
            close_old_connections()

        for agent_run_id in candidates:
            try:
                observation = self._runtime.inspect(agent_run_id)
            except (TerminalObservationError, TerminalRuntimeError):
                logger.warning(
                    "terminal recovery observation unavailable agent_run_id=%s",
                    agent_run_id,
                    exc_info=True,
                )
                continue
            if observation.state is not TerminalState.RUNNING:
                continue
            recovered_at = datetime.now(timezone.utc).isoformat()
            try:
                recovery = persist_runtime_recovery(
                    agent_run_id,
                    recovered_at=recovered_at,
                    runtime_namespace=self._runtime_namespace,
                    owned_namespaces=owned_namespaces,
                )
            except Exception:
                logger.exception(
                    "terminal recovery persistence failed agent_run_id=%s",
                    agent_run_id,
                )
                result.persistence_failed.append(agent_run_id)
                continue
            if recovery.recovered:
                result.recovered.append(agent_run_id)
                publish_runtime_recovery(
                    agent_run_id,
                    recovered_at=recovered_at,
                )

    def _cleanup_retained_runtime(self, agent_run_id: str) -> None:
        """Retry idempotent runtime cleanup until its durable marker clears."""

        try:
            self._runtime.terminate(agent_run_id)
        except TerminalRuntimeError:
            # The application outcome is already authoritative. Keeping the
            # marker set makes a later reconciliation retry only the cleanup.
            logger.warning(
                "retained terminal cleanup failed agent_run_id=%s",
                agent_run_id,
                exc_info=True,
            )
            return

        try:
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                runtime_cleanup_pending=True,
                runtime_namespace=self._runtime_namespace,
            ).update(runtime_cleanup_pending=False)
        except Exception:
            # Termination is idempotent, so retaining the marker is safe and
            # ensures a failed acknowledgement write is retried as well.
            logger.exception(
                "retained terminal cleanup acknowledgement failed "
                "agent_run_id=%s",
                agent_run_id,
            )
        finally:
            close_old_connections()


def reconcile_terminals() -> ReconcileResult:
    """Run application reconciliation against the configured public runtime."""

    from apps.terminals.launch import terminal_runtime

    return TerminalReconciler(terminal_runtime).reconcile()
