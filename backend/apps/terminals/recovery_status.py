"""Status-feed publication for repaired live terminal sessions."""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync

from apps.runs import dao
from apps.runs.bus import publish_status
from studio_server.contracts import AgentLifecycleFrame, RunRecord


logger = logging.getLogger(__name__)


def publish_runtime_recovery(agent_run_id: str, *, recovered_at: str) -> None:
    """Publish a newer live record after a tombstone is durably repaired."""

    try:
        routing = async_to_sync(dao.get_status_routing)(agent_run_id)
    except Exception:
        logger.warning(
            "terminal recovery status routing unavailable agent_run_id=%s",
            agent_run_id,
            exc_info=True,
        )
        return
    if routing is None:
        return

    project_id, task_id, module_id, scope, agent, started_at = routing
    async_to_sync(publish_status)(
        project_id,
        AgentLifecycleFrame(
            at=recovered_at,
            run=RunRecord(
                agent_run_id=agent_run_id,
                project_id=project_id,
                task_id=task_id,
                module_id=module_id,
                agent=agent,
                scope=scope,
                started_at=started_at,
                state="working",
                updated_at=recovered_at,
            ),
        ).model_dump(),
    )
