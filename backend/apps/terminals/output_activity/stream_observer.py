"""Coalesce a streaming terminal's bytes into activity observations.

A byte pump must never wait on status persistence, and a busy terminal must not
turn every 4 KiB chunk into a database write. This observer records only that
*something* was streamed, then captures and reports the newest rendered screen
out of band: immediately for the first change so a stalled terminal recovers
without a perceptible delay, and at most once per interval afterwards.
"""

from __future__ import annotations

import asyncio

from apps.terminals.output_activity.capture import observe_terminal_output


# Upper bound on how often one streaming terminal is captured and compared.
DEFAULT_OBSERVATION_INTERVAL_SECONDS = 0.5


class TerminalOutputObserver:
    """Report one durable session's output activity while a viewer streams it."""

    def __init__(
        self,
        agent_run_id: str,
        *,
        interval_seconds: float = DEFAULT_OBSERVATION_INTERVAL_SECONDS,
    ) -> None:
        self._agent_run_id = agent_run_id
        self._interval = interval_seconds
        self._streamed = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        """Begin observing; safe to call once per attached viewer."""

        if self._task is None:
            self._task = asyncio.create_task(self._run())

    def note_output(self) -> None:
        """Record that bytes were streamed. Never blocks the byte pump."""

        self._streamed.set()

    def close(self) -> None:
        """Stop observing. Pending observations are abandoned, not awaited."""

        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _run(self) -> None:
        while True:
            await self._streamed.wait()
            # Cleared before the capture so bytes that arrive *during* it are
            # observed by the next pass rather than silently dropped.
            self._streamed.clear()
            await self._observe()
            await asyncio.sleep(self._interval)

    async def _observe(self) -> None:
        await observe_terminal_output(self._agent_run_id)
