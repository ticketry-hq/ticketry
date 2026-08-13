"""Startup and periodic reconciliation for the durable transition inbox."""

from __future__ import annotations

import asyncio
import logging
import os
from math import isfinite

from apps.execution.transition_occurrences import reconcile_pending_occurrences


logger = logging.getLogger(__name__)
DEFAULT_INTERVAL_SECONDS = 1.0
_drain_task: asyncio.Task[None] | None = None


def _interval_seconds() -> float | None:
    raw = os.environ.get(
        "MUXED_TRANSITION_RECONCILE_SECONDS", str(DEFAULT_INTERVAL_SECONDS)
    )
    try:
        interval = float(raw)
    except (TypeError, ValueError):
        return None
    return interval if interval > 0 and isfinite(interval) else None


async def _drain_once() -> None:
    try:
        await asyncio.to_thread(reconcile_pending_occurrences)
    except Exception:
        logger.warning("transition occurrence reconciliation failed", exc_info=True)


async def _drain_loop(interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        await _drain_once()


async def start() -> None:
    """Drain the restart backlog, then keep a singleton periodic reconciler."""

    global _drain_task
    if _drain_task is not None:
        return
    await _drain_once()
    interval = _interval_seconds()
    if interval is not None:
        _drain_task = asyncio.create_task(
            _drain_loop(interval), name="transition-occurrence-reconciler"
        )


async def stop() -> None:
    global _drain_task
    task = _drain_task
    _drain_task = None
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
