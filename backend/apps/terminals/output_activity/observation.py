"""The one application operation every terminal output adapter reports to.

Browser WebSocket output and (from #662) the native viewer path both hand one
observation to :func:`record_terminal_output`. There is exactly one place that
decides whether output changed, advances the durable activity axis, and
publishes the updated run projection — no adapter carries its own status
algorithm.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apps.runs import dao
from apps.runs.bus import publish_status
from apps.terminals.output_activity.identity import output_identity
from apps.terminals.output_activity.store import advance_output_identity
from studio_server.contracts import TerminalActivityFrame


logger = logging.getLogger(__name__)


async def record_terminal_output(agent_run_id: str, screen: bytes) -> bool:
    """Apply one terminal-output observation for a durable session.

    Idempotent for a duplicate or reconnect observation: an unchanged identity
    advances nothing, publishes nothing, and therefore does not extend the
    inactivity deadline. The timestamp is taken from the backend clock, never
    from the reporting adapter.

    This never raises. Terminal-output activity is status telemetry; a failed
    write or publication must not block, reorder, or corrupt the byte stream
    the person is watching.

    :param agent_run_id: the durable terminal session's public handle.
    :param screen: the bytes a capture of that terminal rendered.
    :return: whether the observation advanced the activity axis.
    """

    try:
        observed_at = datetime.now(timezone.utc).isoformat()
        changed = await advance_output_identity(
            agent_run_id,
            identity=output_identity(screen),
            observed_at=observed_at,
        )
        if not changed:
            return False
        # A doc-chat run advances its own activity axis but never appears on
        # the project status feed: the snapshot, the lifecycle delta and the
        # recovery frame all omit it, so publishing here would seed the client
        # with a run its next snapshot retires as a phantom exited row.
        record = await dao.agent_status_record(agent_run_id)
        if record is not None and record.scope != "docchat":
            frame = TerminalActivityFrame(at=observed_at, run=record)
            await publish_status(record.project_id, frame.model_dump())
        return True
    except Exception as exc:
        logger.warning(
            "terminal output activity not recorded agent_run_id=%s: %s",
            agent_run_id,
            exc,
        )
        return False
