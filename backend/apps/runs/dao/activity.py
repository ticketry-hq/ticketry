from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from django.db.models import Max
from django.db.models.functions import Coalesce

from apps.runs.models import AgentRun
from apps.runs.dao.constants import DEFAULT_ACTIVITY_WINDOW_DAYS
from apps.runs.run_scopes import SHELL_SCOPE


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
