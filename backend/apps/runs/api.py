"""Lifecycle ingress endpoint (ticket #498/#512), ported to ninja."""

import logging
from datetime import datetime, timezone

from django.db import transaction
from django.http import JsonResponse
from studio_server.contracts import (
    AutomationAttemptRecord,
    AgentStatusScope,
    AgentStatusSnapshot,
    AgentLifecycleFrame,
    LifecycleEvent,
    RunRecord,
    reduce_lifecycle,
)
from ninja import Router, Status
from worktracker.auth import ApiKeyAuth

from apps.runs import dao
from apps.runs.bus import publish_status
from apps.runs.models import AutomationAttempt
from apps.runs.projections import automation_attempt_record


logger = logging.getLogger(__name__)

router = Router(tags=["lifecycle"])


@router.post(
    "/automation-attempts/{attempt_id}/retry",
    response={200: AutomationAttemptRecord},
    auth=ApiKeyAuth(),
)
def retry_automation_attempt(request, attempt_id: str):
    """Create at most one explicit retry child for one failed attempt."""

    with transaction.atomic():
        source = (
            AutomationAttempt.objects.select_for_update()
            .select_related("issue", "root_attempt")
            .filter(pk=attempt_id)
            .first()
        )
        if source is None:
            return JsonResponse({"error": "automation_attempt_not_found"}, status=404)
        existing = AutomationAttempt.objects.filter(retry_of=source).first()
        if existing is not None:
            return automation_attempt_record(existing)
        if source.status != AutomationAttempt.Status.FAILED:
            return JsonResponse({"error": "automation_attempt_not_failed"}, status=409)
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


@router.post("/lifecycle/events", response={202: dict})
async def ingest_lifecycle_event(request, event: LifecycleEvent):
    """Ingest one agent lifecycle/attention event and relay it (#498/#512).

    :param request: the inbound HTTP request (unused).
    :param event: the normalized lifecycle envelope from a per-agent hook.
    :return: a ``202`` tuple echoing the event and its receive timestamp.
    """

    received_at = datetime.now(timezone.utc).isoformat()

    if event.provider_session_id:
        try:
            await dao.set_provider_session_id(
                event.agent_run_id, event.provider_session_id
            )
        except Exception as exc:
            logger.warning("failed to persist provider_session_id: %s", exc)

    # Reduce the event kind to a lifecycle state and persist it as the run's
    # latest state (#515). Unrecognized kinds reduce to None and are skipped.

    state = reduce_lifecycle(event.kind)
    if state is not None:
        # Persist the state and read the run's routing keys, so the relayed
        # frame can be placed under the right task (#512).

        routing = None
        try:
            event_at = dao.normalize_utc_timestamp(event.ts)
            persisted = await dao.set_lifecycle_state(
                event.agent_run_id, state, updated_at=event_at
            )
            if persisted:
                routing = await dao.get_status_routing(event.agent_run_id)
        except Exception as exc:
            logger.warning("failed to persist lifecycle_state: %s", exc)

        # Relay to the run's module bus. The frame carries the resolved task_id
        # so the client places it without a lookup; missing routing is skipped.

        if routing is not None:
            project_id, task_id, module_id, scope = routing
            frame = AgentLifecycleFrame(
                at=event_at,
                run=RunRecord(
                    agent_run_id=event.agent_run_id,
                    task_id=task_id,
                    module_id=module_id,
                    scope=scope,
                    state=state,
                    updated_at=event_at,
                ),
            )
            await publish_status(project_id, frame.model_dump())

    return Status(202, {"accepted": event.model_dump(), "received_at": received_at})


@router.get("/runs/module-activity", response={200: dict})
async def get_module_activity(
    request,
    project_id: str,
    window_days: int = dao.DEFAULT_ACTIVITY_WINDOW_DAYS,
):
    """Return the most recent agent interaction per module (#598).

    Backs the frontend's recency sort of the module list. Modules with no
    qualifying run within the window are simply absent from the map.

    :param request: the inbound HTTP request (unused).
    :param project_id: scope the activity query to one project.
    :param window_days: lookback cap in days; older runs are excluded.
    :return: a ``{module_id: iso8601}`` map.
    """

    return await dao.last_activity_by_module(project_id, window_days=window_days)


@router.get("/runs/agent-status", response={200: AgentStatusSnapshot})
async def agent_status(request, project_id: str, task_id: str | None = None):
    """Return the authoritative run-status snapshot for a project or task."""

    at = datetime.now(timezone.utc).isoformat()
    return AgentStatusSnapshot(
        scope=AgentStatusScope(project_id=project_id, task_id=task_id),
        runs=await dao.agent_status_records(project_id, task_id=task_id),
        automation_attempts=await dao.automation_attempt_status_records(
            project_id, task_id=task_id
        ),
        at=at,
    )
