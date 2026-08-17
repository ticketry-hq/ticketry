"""Status-feed publication for repaired live terminal sessions."""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync

from apps.runs import dao
from apps.runs.bus import publish_status
from studio_server.contracts import AgentLifecycleFrame


logger = logging.getLogger(__name__)


def publish_runtime_recovery(agent_run_id: str, *, recovered_at: str) -> None:
    """Publish a newer live record after a tombstone is durably repaired."""

    try:
        record = async_to_sync(dao.agent_status_record)(agent_run_id)
    except Exception:
        logger.warning(
            "terminal recovery status routing unavailable agent_run_id=%s",
            agent_run_id,
            exc_info=True,
        )
        return
    if record is None or record.scope == "docchat":
        return

    # The repaired row is authoritative for both axes; publishing its own
    # projection keeps the recovery frame from resetting output activity.
    async_to_sync(publish_status)(
        record.project_id,
        AgentLifecycleFrame(at=recovered_at, run=record).model_dump(),
    )
