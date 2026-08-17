"""Turn "this terminal produced output" into one recorded observation.

Every adapter — the browser byte pump and the native viewer alike — reports
only that a session produced output. Reading the rendered screen, digesting it,
and deciding whether anything actually changed happens here and in
:mod:`apps.terminals.output_activity.observation`, so no adapter carries its
own idea of what changed output is.
"""

from __future__ import annotations

import asyncio
import logging

from apps.terminals import viewer_attachments
from apps.terminals.output_activity.observation import record_terminal_output


logger = logging.getLogger(__name__)


async def observe_terminal_output(agent_run_id: str) -> bool:
    """Capture one durable session's screen and record the observation.

    A runtime that cannot be captured is a silent status miss, never an error
    raised into a caller that is rendering or streaming a terminal.

    :param agent_run_id: the durable terminal session's public handle.
    :return: whether the observation advanced the activity axis.
    """

    try:
        screen = await asyncio.to_thread(
            viewer_attachments.capture_screen,
            agent_run_id,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.debug(
            "terminal screen capture failed agent_run_id=%s: %s",
            agent_run_id,
            exc,
        )
        return False
    return await record_terminal_output(agent_run_id, screen)
