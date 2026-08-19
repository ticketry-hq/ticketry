"""Read projections over the Rust-owned Agent Run table.

Every Agent Run writer moved to Rust at the Slice 3 handoff. What survives here
is the shared UTC normalizer and the routing/listing reads that Python-owned
capabilities still consume while their own slices are outstanding.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from django.db.models.functions import Coalesce

from apps.runs.models import AgentRun


def normalize_utc_timestamp(value: str) -> str:
    """Return one sortable ISO-8601 representation, treating naive input as UTC."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


async def get_run_routing(run_id: str) -> Optional[tuple[Optional[str], str]]:
    """Return a run's task and module routing keys."""

    routing = (
        await AgentRun.objects.filter(id=run_id)
        .annotate(run_module_id=Coalesce("issue__module_id", "issue_id"))
        .values_list("issue_id", "issue__type", "run_module_id")
        .afirst()
    )
    if routing is None:
        return None
    issue_id, issue_type, module_id = routing
    return (
        str(issue_id) if issue_type == "task" else None,
        str(module_id),
    )


async def get_status_routing(
    run_id: str,
) -> Optional[tuple[str, Optional[str], str, str, str, str]]:
    """Return the immutable identity and routing fields owned by a run."""

    routing = (
        await AgentRun.objects.filter(id=run_id).exclude(scope="docchat")
        .annotate(run_module_id=Coalesce("issue__module_id", "issue_id"))
        .values_list(
            "issue__project_id",
            "issue_id",
            "issue__type",
            "run_module_id",
            "scope",
            "agent",
            "started_at",
        )
        .afirst()
    )
    if routing is None:
        return None
    project_id, issue_id, issue_type, module_id, scope, agent, started_at = routing
    return (
        str(project_id),
        str(issue_id) if issue_type == "task" else None,
        str(module_id),
        scope,
        agent,
        started_at,
    )


async def list_agent_runs_for_task(
    task_id: str,
    *,
    limit: Optional[int] = None,
) -> list[AgentRun]:
    """Return a task's runs ordered newest-first."""

    rows = AgentRun.objects.filter(issue_id=task_id).order_by("-started_at")
    if limit is not None:
        rows = rows[:limit]
    return [row async for row in rows]
