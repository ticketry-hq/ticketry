from __future__ import annotations

import uuid

from apps.runs.models import AutomationAttempt
from apps.runs.projections import automation_attempt_record
from studio_server.contracts import AutomationAttemptRecord


async def automation_attempt_status_records(
    project_id: str, *, task_id: str | None = None
) -> list[AutomationAttemptRecord]:
    """Return each retry lineage's latest unresolved project-scoped outcome."""

    try:
        scoped_project_id = uuid.UUID(project_id)
        scoped_task_id = uuid.UUID(task_id) if task_id is not None else None
    except ValueError:
        # AgentRun's historical routing keys are strings, while durable work
        # items (and therefore automation attempts) are UUID-scoped.
        return []

    rows = AutomationAttempt.objects.filter(
        issue__project_id=scoped_project_id,
        dismissed_at__isnull=True,
    )
    if task_id is not None:
        rows = rows.filter(issue_id=scoped_task_id)
    rows = rows.order_by("-updated_at", "-created_at").select_related("root_attempt")

    seen_roots: set[str] = set()
    records: list[AutomationAttemptRecord] = []
    async for attempt in rows:
        root_id = str(attempt.root_attempt_id or attempt.id)
        if root_id in seen_roots:
            continue
        seen_roots.add(root_id)
        if attempt.status == AutomationAttempt.Status.SUCCEEDED:
            continue
        records.append(automation_attempt_record(attempt))
    return records
