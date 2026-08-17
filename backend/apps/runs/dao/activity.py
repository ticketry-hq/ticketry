from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from django.db.models import Max, Q, Value
from django.db.models.functions import Coalesce, Greatest

from apps.runs.models import AgentRun
from apps.runs.dao.constants import DEFAULT_ACTIVITY_WINDOW_DAYS
from apps.runs.run_scopes import SHELL_SCOPE
from apps.runs.run_records import build_run_record
from studio_server.contracts import RunRecord


async def list_design_dirs_for_task(
    task_id: str,
    *,
    module_id: Optional[str] = None,
) -> list[str]:
    """Return distinct non-null design directories for a task."""

    rows = AgentRun.objects.filter(issue_id=task_id, design_dir__isnull=False)
    if module_id is not None:
        rows = rows.filter(issue__module_id=module_id)
    values = rows.values_list("design_dir", flat=True).distinct()
    return [value async for value in values]


async def last_activity_by_module(
    project_id: str,
    *,
    window_days: int = DEFAULT_ACTIVITY_WINDOW_DAYS,
    now: Optional[datetime] = None,
) -> dict[str, str]:
    """Return the most recent agent interaction per module for a project (#598).

    Recency per run is ``COALESCE(lifecycle_updated_at, started_at)`` and a
    module's signal is the ``MAX`` of that across its runs. Only runs started
    within ``window_days`` qualify; modules with no qualifying run are absent.

    Shell runs are excluded (#685). A panel shell is an ``AgentRun`` whose
    issue *is* the module work item, so ``COALESCE(module_id, issue_id)`` files
    it under the module itself — opening a shell would otherwise stamp "most
    recent agent interaction" on the module and reorder the module list. This
    mirrors the ``SHELL_SCOPE`` guard the terminals API and the Studio
    selectors already apply.

    Timestamps are ISO-8601 UTC strings written by a single formatter (the
    terminal consumer's ``started_at`` and the lifecycle ingest's
    ``lifecycle_updated_at``), so lexicographic ``MAX`` ranks correctly.

    :param project_id: scope the query to one project's runs.
    :param window_days: lookback cap; runs older than this are excluded.
    :param now: Reference "now" (injectable for tests); defaults to UTC now.
    :return: a ``{module_id: iso8601}`` map, newest interaction per module.
    """

    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=window_days)).isoformat()
    rows = (
        AgentRun.objects.filter(
            issue__project_id=project_id, started_at__gte=cutoff
        )
        .exclude(scope=SHELL_SCOPE)
        .annotate(module_key=Coalesce("issue__module_id", "issue_id"))
        .values("module_key")
        .annotate(
            last_activity=Max(Coalesce("lifecycle_updated_at", "started_at"))
        )
    )
    return {str(row["module_key"]): row["last_activity"] async for row in rows}


async def agent_status_records(
    project_id: str,
    *,
    runtime_namespace: str,
    task_id: Optional[str] = None,
    window_days: int = DEFAULT_ACTIVITY_WINDOW_DAYS,
    now: Optional[datetime] = None,
) -> list[RunRecord]:
    """Return locally active runs plus recent ended tombstones for a scope.

    An unresolved run owned by another terminal runtime is not locally live:
    this backend cannot discover or reconcile its tmux session. Excluding that
    row keeps the status snapshot aligned with terminal discovery and lets the
    client retire a previously observed ghost run. Current launch persistence
    creates the run and terminal mirror atomically, so a terminal-less active
    row is likewise an orphan rather than a locally observable run.
    """

    rows = AgentRun.objects.filter(issue__project_id=project_id).exclude(
        scope="docchat"
    ).select_related("issue")
    if task_id is not None:
        rows = rows.filter(issue_id=task_id)
    rows = rows.annotate(
        run_module_id=Coalesce("issue__module_id", "issue_id"),
        status_updated_at=Greatest(
            Coalesce("lifecycle_updated_at", "started_at"),
            Coalesce("ended_at", "started_at"),
        ),
        # The terminal-output activity axis travels with the snapshot so a
        # reconnecting client reconstructs the same effective state from
        # persisted facts instead of a browser-local timer (#661).
        output_sequence=Coalesce("agentterminalsession__output_sequence", Value(0)),
        last_output_at=Coalesce(
            "agentterminalsession__last_output_at",
            "agentterminalsession__created_at",
        ),
    )
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=window_days)).isoformat()
    rows = rows.filter(
        Q(ended_at__isnull=False)
        | Q(
            agentterminalsession__runtime_namespace=runtime_namespace,
            agentterminalsession__terminated_at__isnull=True,
        )
    ).filter(
        Q(ended_at__isnull=True) | Q(status_updated_at__gte=cutoff)
    ).order_by("-status_updated_at", "-id")

    return [
        build_run_record(
            run,
            module_id=str(run.run_module_id),
            output_sequence=run.output_sequence,
            last_output_at=run.last_output_at,
            now=now,
        )
        async for run in rows
    ]


async def agent_status_record(agent_run_id: str) -> Optional[RunRecord]:
    """Return one run's authoritative status record, or ``None`` if unknown.

    Used by activity publication so a delta carries the same projection the
    snapshot would produce for that run.
    """

    run = (
        await AgentRun.objects.filter(id=agent_run_id)
        .select_related("issue")
        .annotate(
            run_module_id=Coalesce("issue__module_id", "issue_id"),
            output_sequence=Coalesce("agentterminalsession__output_sequence", Value(0)),
            last_output_at=Coalesce(
                "agentterminalsession__last_output_at",
                "agentterminalsession__created_at",
            ),
        )
        .afirst()
    )
    if run is None:
        return None
    return build_run_record(
        run,
        module_id=str(run.run_module_id),
        output_sequence=run.output_sequence,
        last_output_at=run.last_output_at,
    )
