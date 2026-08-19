"""Transport-independent Runs operations after the Slice 3 handoff.

Every durable Runs write is a Rust command now. What remains here is the
normalized loopback adapter for provider lifecycle hooks — those stay outside
the WebView trust boundary, so the hook still posts to Django — plus the read
projections capabilities that have not migrated yet still consume. The adapter
acknowledges its own caller only after Rust reports the fact committed, which
is what makes spool replay and HTTP retry harmless.
"""

import asyncio
import logging
from datetime import datetime, timezone

from apps.errors import ApplicationError
from studio_server.contracts import (
    AgentStatusScope,
    AgentStatusSnapshot,
    LifecycleEvent,
)

from apps.runs import dao, rust_port


logger = logging.getLogger(__name__)


def retry_automation_attempt(attempt_id: str):
    """Retired. Automation Attempt retry is an authored Rust GraphQL command.

    Studio calls that command directly. Keeping a second Django writer here
    would mean two authorities for one retry lineage, which is exactly what
    the handoff exists to prevent.
    """

    raise ApplicationError(
        410,
        "django_slice3_write_disabled",
        code="django_slice3_write_disabled",
    )


async def ingest_lifecycle_event(event: LifecycleEvent):
    """Adapt one provider hook onto the authoritative Rust lifecycle command.

    The response is the acknowledgement contract for the hook runner and its
    atomic spool: a ``202`` means the fact is durable in Rust. A refusal is
    raised so the caller retries rather than dropping a spooled fact.
    """

    received_at = datetime.now(timezone.utc).isoformat()
    try:
        occurred_at = dao.normalize_utc_timestamp(event.ts)
    except (TypeError, ValueError):
        raise ApplicationError(400, "timestamp_invalid", code="timestamp_invalid")

    try:
        await asyncio.to_thread(
            rust_port.apply_lifecycle_fact,
            event.agent_run_id,
            event.kind,
            occurred_at,
            event.provider_session_id or None,
        )
    except rust_port.RunsPortUnavailable as unavailable:
        # Never acknowledge a fact that was not committed: the spool file
        # survives and the same delivery is replayed, which is a no-op once it
        # does commit.
        logger.warning("lifecycle ingress refused code=%s", unavailable.code)
        raise ApplicationError(
            503, "lifecycle_unavailable", code=unavailable.code
        ) from unavailable

    return 202, {"accepted": event.model_dump(), "received_at": received_at}


async def get_module_activity(
    project_id: str,
    window_days: int = dao.DEFAULT_ACTIVITY_WINDOW_DAYS,
):
    """Return the most recent agent interaction per module (#598).

    Backs the frontend's recency sort of the module list. Modules with no
    qualifying run within the window are simply absent from the map.

    :param project_id: scope the activity query to one project.
    :param window_days: lookback cap in days; older runs are excluded.
    :return: a ``{module_id: iso8601}`` map.
    """

    return await dao.last_activity_by_module(project_id, window_days=window_days)


async def agent_status(project_id: str, task_id: str | None = None):
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
