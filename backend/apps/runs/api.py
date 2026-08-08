"""Transport-independent lifecycle application operations."""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from django.db import transaction
from django.db.models import Max, Q
from django.db.models.functions import Coalesce, Greatest
from apps.errors import ApplicationError
from studio_server.contracts import reduce_lifecycle

from apps.runs.bus import publish_status
from apps.runs.models import AgentRun, AutomationAttempt
from apps.runs.projections import automation_attempt_record


logger = logging.getLogger(__name__)
DEFAULT_ACTIVITY_WINDOW_DAYS = 30


def normalize_utc_timestamp(value: str) -> str:
    """Return one sortable ISO-8601 representation, treating naive input as UTC."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


async def set_provider_session_id(run_id: str, provider_session_id: str) -> bool:
    updated = await AgentRun.objects.filter(id=run_id).aupdate(
        provider_session_id=provider_session_id
    )
    return updated > 0


async def set_lifecycle_state(
    run_id: str, lifecycle_state: str, *, updated_at: str
) -> bool:
    """Persist a newer lifecycle state only while the run remains active."""

    normalized = normalize_utc_timestamp(updated_at)
    updated = (
        await AgentRun.objects.filter(id=run_id, ended_at__isnull=True)
        .filter(
            Q(lifecycle_updated_at__isnull=True)
            | Q(lifecycle_updated_at__lt=normalized)
        )
        .aupdate(lifecycle_state=lifecycle_state, lifecycle_updated_at=normalized)
    )
    return updated > 0


async def get_status_routing(
    run_id: str,
) -> Optional[tuple[str, Optional[str], str, str, str, str]]:
    routing = (
        await AgentRun.objects.filter(id=run_id)
        .exclude(scope="docchat")
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


async def list_design_dirs_for_task(
    task_id: str, *, module_id: Optional[str] = None
) -> list[str]:
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
    cutoff = (
        (now or datetime.now(timezone.utc)) - timedelta(days=window_days)
    ).isoformat()
    rows = (
        AgentRun.objects.filter(issue__project_id=project_id, started_at__gte=cutoff)
        .annotate(module_key=Coalesce("issue__module_id", "issue_id"))
        .values("module_key")
        .annotate(last_activity=Max(Coalesce("lifecycle_updated_at", "started_at")))
    )
    return {str(row["module_key"]): row["last_activity"] async for row in rows}


async def agent_status_records(
    project_id: str,
    *,
    task_id: Optional[str] = None,
    window_days: int = DEFAULT_ACTIVITY_WINDOW_DAYS,
    now: Optional[datetime] = None,
) -> list[dict]:
    rows = (
        AgentRun.objects.filter(issue__project_id=project_id)
        .exclude(scope="docchat")
        .select_related("issue")
    )
    if task_id is not None:
        rows = rows.filter(issue_id=task_id)
    rows = rows.annotate(
        run_module_id=Coalesce("issue__module_id", "issue_id"),
        status_updated_at=Greatest(
            Coalesce("lifecycle_updated_at", "started_at"),
            Coalesce("ended_at", "started_at"),
        ),
    )
    cutoff = (
        (now or datetime.now(timezone.utc)) - timedelta(days=window_days)
    ).isoformat()
    rows = rows.filter(
        Q(ended_at__isnull=True) | Q(status_updated_at__gte=cutoff)
    ).order_by("-status_updated_at", "-id")

    records: list[dict] = []
    async for run in rows:
        if run.ended_at:
            state = "exited"
            updated_at = max(filter(None, (run.ended_at, run.lifecycle_updated_at)))
        else:
            state = run.lifecycle_state or "unknown"
            updated_at = run.lifecycle_updated_at or run.started_at
        records.append(
            {
                "agent_run_id": run.id,
                "project_id": str(run.issue.project_id),
                "task_id": str(run.issue_id) if run.issue.type == "task" else None,
                "module_id": str(run.run_module_id),
                "agent": run.agent,
                "scope": run.scope,
                "started_at": run.started_at,
                "state": state,
                "updated_at": updated_at,
            }
        )
    return records


async def automation_attempt_status_records(
    project_id: str, *, task_id: str | None = None
) -> list[dict]:
    try:
        scoped_project_id = uuid.UUID(project_id)
        scoped_task_id = uuid.UUID(task_id) if task_id is not None else None
    except ValueError:
        return []
    rows = AutomationAttempt.objects.filter(
        issue__project_id=scoped_project_id,
        dismissed_at__isnull=True,
    )
    if task_id is not None:
        rows = rows.filter(issue_id=scoped_task_id)
    rows = rows.order_by("-updated_at", "-created_at").select_related("root_attempt")
    seen_roots: set[str] = set()
    records: list[dict] = []
    async for attempt in rows:
        root_id = str(attempt.root_attempt_id or attempt.id)
        if root_id in seen_roots:
            continue
        seen_roots.add(root_id)
        if attempt.status == AutomationAttempt.Status.SUCCEEDED:
            continue
        records.append(automation_attempt_record(attempt))
    return records


def retry_automation_attempt(attempt_id: str):
    """Create at most one explicit retry child for one failed attempt."""

    with transaction.atomic():
        source = (
            AutomationAttempt.objects.select_for_update()
            .select_related("issue")
            .filter(pk=attempt_id)
            .first()
        )
        if source is None:
            raise ApplicationError(
                404,
                "automation_attempt_not_found",
                code="automation_attempt_not_found",
            )
        existing = AutomationAttempt.objects.filter(retry_of=source).first()
        if existing is not None:
            return automation_attempt_record(existing)
        if source.status != AutomationAttempt.Status.FAILED:
            raise ApplicationError(
                409,
                "automation_attempt_not_failed",
                code="automation_attempt_not_failed",
            )
        if not source.retryable:
            raise ApplicationError(
                409,
                "automation_attempt_not_retryable",
                code="automation_attempt_not_retryable",
                metadata={"failure": source.error_details},
            )
        retry = AutomationAttempt.objects.create(
            transition_id=source.transition_id,
            issue=source.issue,
            from_state_id=source.from_state_id,
            to_state_id=source.to_state_id,
            workflow_revision=source.workflow_revision,
            retry_of=source,
            root_attempt=source.root_attempt or source,
        )

    # Import lazily to keep the runs transport app independent at import time.
    from apps.execution.signals import run_automation_attempt

    run_automation_attempt(retry, destination_state_id=str(retry.to_state_id))
    return automation_attempt_record(retry)


async def ingest_lifecycle_event(
    *,
    agent_run_id: str,
    agent: str,
    kind: str,
    ts: str,
    message: str | None = None,
    source: str = "hook",
    provider_session_id: str | None = None,
):
    """Ingest one agent lifecycle/attention event and relay it (#498/#512).

    Inputs are already validated by the calling transport (DRF or hook adapter).
    :return: a ``202`` tuple echoing the event and its receive timestamp.
    """

    received_at = datetime.now(timezone.utc).isoformat()

    if provider_session_id:
        try:
            await set_provider_session_id(agent_run_id, provider_session_id)
        except Exception as exc:
            logger.warning("failed to persist provider_session_id: %s", exc)

    # Reduce the event kind to a lifecycle state and persist it as the run's
    # latest state (#515). Unrecognized kinds reduce to None and are skipped.

    state = reduce_lifecycle(kind)
    if state is not None:
        # Persist the state and read the run's routing keys, so the relayed
        # frame can be placed under the right task (#512).

        routing = None
        try:
            event_at = normalize_utc_timestamp(ts)
            persisted = await set_lifecycle_state(
                agent_run_id, state, updated_at=event_at
            )
            if persisted:
                routing = await get_status_routing(agent_run_id)
        except Exception as exc:
            logger.warning("failed to persist lifecycle_state: %s", exc)

        # Relay to the run's module bus. The frame carries the resolved task_id
        # so the client places it without a lookup; missing routing is skipped.

        if routing is not None:
            project_id, task_id, module_id, scope, run_agent, started_at = routing
            await publish_status(
                project_id,
                {
                    "v": 1,
                    "type": "agent_lifecycle",
                    "at": event_at,
                    "run": {
                        "agent_run_id": agent_run_id,
                        "project_id": project_id,
                        "task_id": task_id,
                        "module_id": module_id,
                        "agent": run_agent,
                        "scope": scope,
                        "started_at": started_at,
                        "state": state,
                        "updated_at": event_at,
                    },
                },
            )

    return 202, {
        "accepted": {
            "agent_run_id": agent_run_id,
            "agent": agent,
            "kind": kind,
            "ts": ts,
            "message": message,
            "source": source,
            "provider_session_id": provider_session_id,
        },
        "received_at": received_at,
    }


async def get_module_activity(
    project_id: str,
    window_days: int = DEFAULT_ACTIVITY_WINDOW_DAYS,
):
    """Return the most recent agent interaction per module (#598).

    Backs the frontend's recency sort of the module list. Modules with no
    qualifying run within the window are simply absent from the map.

    :param project_id: scope the activity query to one project.
    :param window_days: lookback cap in days; older runs are excluded.
    :return: a ``{module_id: iso8601}`` map.
    """

    return await last_activity_by_module(project_id, window_days=window_days)


async def agent_status(project_id: str, task_id: str | None = None):
    """Return the authoritative run-status snapshot for a project or task."""

    at = datetime.now(timezone.utc).isoformat()
    return {
        "scope": {"project_id": project_id, "task_id": task_id},
        "runs": await agent_status_records(project_id, task_id=task_id),
        "automation_attempts": await automation_attempt_status_records(
            project_id, task_id=task_id
        ),
        "at": at,
    }
