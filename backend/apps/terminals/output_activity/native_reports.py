"""The native renderer's half of the shared output-observation contract.

libghostty owns its own PTY, so the desktop's bytes never pass through
Ticketry. The native viewer therefore reports the one fact an adapter is
allowed to report — "this durable session produced output" — and the shared
operation still does the capture, the comparison, and the persistence. That
keeps a single status algorithm in the backend rather than a second one in Rust
or Studio.

Reports are coalesced per durable session with the same upper bound the browser
byte pump uses, so several retained viewers of one run, or a chatty caller,
cannot turn into a capture storm. The first report after a quiet period is
never delayed, so a stalled terminal recovers as promptly as it does in the
browser.
"""

from __future__ import annotations

import time

from apps.terminals.output_activity.capture import observe_terminal_output
from apps.terminals.output_activity.stream_observer import (
    DEFAULT_OBSERVATION_INTERVAL_SECONDS,
)


# How long a session's report record survives with no further reports. Only
# large enough to bound the map for detached viewers; unrelated to the stall
# deadline, which the status projection owns.
_REPORT_RETENTION_SECONDS = 60.0

_last_observed: dict[str, float] = {}


async def report_native_output(
    agent_run_id: str,
    *,
    interval_seconds: float = DEFAULT_OBSERVATION_INTERVAL_SECONDS,
) -> bool:
    """Apply one native viewer's output report.

    :param agent_run_id: the durable terminal session the viewer renders.
    :param interval_seconds: upper bound on captures for one session.
    :return: whether this report advanced the activity axis. A coalesced or
        unchanged report advances nothing and therefore extends no deadline.
    """

    now = time.monotonic()
    _forget_stale_reports(now)
    previous = _last_observed.get(agent_run_id)
    if previous is not None and now - previous < interval_seconds:
        return False
    _last_observed[agent_run_id] = now
    return await observe_terminal_output(agent_run_id)


def _forget_stale_reports(now: float) -> None:
    for agent_run_id, observed_at in list(_last_observed.items()):
        if now - observed_at >= _REPORT_RETENTION_SECONDS:
            _last_observed.pop(agent_run_id, None)


def reset_native_reports() -> None:
    """Forget every coalescing record. A test seam, not production policy."""

    _last_observed.clear()
