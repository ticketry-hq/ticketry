from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from django.db.models import Max, Q
from django.db.models.functions import Coalesce, Greatest

from apps.runs.models import AgentRun
from apps.runs.dao.constants import DEFAULT_ACTIVITY_WINDOW_DAYS
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
    task_id: Optional[str] = None,
    window_days: int = DEFAULT_ACTIVITY_WINDOW_DAYS,
    now: Optional[datetime] = None,
) -> list[RunRecord]:
    """Return active runs plus recent ended tombstones for a status scope."""

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
    )
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=window_days)).isoformat()
    rows = rows.filter(
        Q(ended_at__isnull=True) | Q(status_updated_at__gte=cutoff)
    ).order_by("-status_updated_at", "-id")

    records: list[RunRecord] = []
    async for run in rows:
        if run.ended_at:
            # An ended run is an exited tombstone regardless of the last
            # lifecycle event it happened to record — otherwise a fresh
            # snapshot can present a terminated run as still `working` (#978).
            state = "exited"
            updated_at = max(
                filter(None, (run.ended_at, run.lifecycle_updated_at))
            )
        else:
            state = run.lifecycle_state or "unknown"
            updated_at = run.lifecycle_updated_at or run.started_at
        records.append(
            RunRecord(
                agent_run_id=run.id,
                project_id=str(run.issue.project_id),
                task_id=str(run.issue_id) if run.issue.type == "task" else None,
                module_id=str(run.run_module_id),
                agent=run.agent,
                run_kind=run.run_kind,
                scope=run.scope,
                started_at=run.started_at,
                state=state,
                updated_at=updated_at,
            )
        )
    return records
