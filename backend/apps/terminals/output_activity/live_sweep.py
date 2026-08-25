"""Observe live terminals nobody is watching (#679).

Both adapters — the browser byte pump and the native viewer report — only exist
while somebody has that terminal attached. Studio deliberately suspends a hidden
browser terminal's socket, and a freshly loaded Studio has no terminal open at
all, so without this sweep an actively working agent's activity axis freezes at
its creation baseline and the run projects ``stalled`` 60 seconds later purely
because no one was looking at it.

This sweep therefore makes the activity axis a property of the durable terminal
rather than of viewer presence: it walks the live sessions this runtime owns and
reports each one through the same shared observation operation the adapters use.
The adapters stay as the fast path — a viewer's first changed byte still clears
``stalled`` without a perceptible delay — while this pass guarantees an upper
bound on how stale an unwatched session's activity may become.

The pass is deliberately its own periodic loop rather than a rider on terminal
reconciliation: reconciliation's cadence (startup, on demand, and the 30-minute
idle sweep) is far coarser than the 60-second stall deadline, so an observation
tied to it would still project ``stalled`` on healthy runs.
"""

from __future__ import annotations

import asyncio
import logging
import os
from math import isfinite

from asgiref.sync import sync_to_async

from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity.capture import observe_terminal_output

logger = logging.getLogger(__name__)


# Comfortably below the 60-second stall deadline, so an unwatched session that
# is producing output never reaches the deadline between two passes.
DEFAULT_SWEEP_INTERVAL_SECONDS = 10.0

# One broken runtime call must finish well before the inactivity deadline and
# must not serialize every other session behind it. The concurrency cap keeps
# a large stale inventory from starting an unbounded number of tmux processes.
OBSERVATION_TIMEOUT_SECONDS = 2.0
MAX_CONCURRENT_OBSERVATIONS = 8

_SWEEP_INTERVAL_ENV = "MUXED_OUTPUT_SWEEP_SECONDS"


def sweep_interval_seconds() -> float | None:
    """Read the configured cadence, or ``None`` when the sweep is disabled."""

    raw_value = os.environ.get(_SWEEP_INTERVAL_ENV)
    if raw_value is None:
        return DEFAULT_SWEEP_INTERVAL_SECONDS
    try:
        seconds = float(raw_value)
    except (TypeError, ValueError):
        return None
    if seconds <= 0 or not isfinite(seconds):
        return None
    return seconds


def _live_session_ids() -> list[str]:
    """List the durable sessions this runtime owns that are still live.

    Scoped to the runtime namespace for the same reason reconciliation is: a row
    belonging to another profile's socket is not ours to capture, and asking for
    it would only produce a failed capture per pass.
    """

    from apps.terminals.launch import terminal_runtime

    return list(
        AgentTerminalSession.objects.filter(
            terminated_at__isnull=True,
            agent_run__ended_at__isnull=True,
            runtime_namespace=terminal_runtime.namespace,
        )
        # A launch still being compensated has no observable runtime yet;
        # reconciliation, not this pass, decides what becomes of it.
        .exclude(agent_run__status="cleanup_pending")
        # New sessions have the least remaining time before their first stall
        # boundary, so observe them before a large stale inventory.
        .order_by("-created_at", "-agent_run_id")
        .values_list("agent_run_id", flat=True)
    )


async def observe_live_sessions() -> int:
    """Observe every live session once; return how many advanced the axis.

    Never raises. A capture that fails is already a silent status miss inside
    the shared operation, and a failed enumeration must not stop the loop that
    will try again on the next pass.
    """

    try:
        agent_run_ids = await sync_to_async(_live_session_ids, thread_sensitive=True)()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("live terminal output sweep could not list sessions: %s", exc)
        return 0

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_OBSERVATIONS)

    async def observe_one(agent_run_id: str) -> bool:
        async with semaphore:
            try:
                return await asyncio.wait_for(
                    observe_terminal_output(agent_run_id),
                    timeout=OBSERVATION_TIMEOUT_SECONDS,
                )
            except asyncio.CancelledError:
                raise
            except TimeoutError:
                logger.debug(
                    "live terminal output observation timed out agent_run_id=%s",
                    agent_run_id,
                )
                return False
            except Exception as exc:  # noqa: BLE001 - isolate best-effort telemetry
                logger.warning(
                    "live terminal output observation failed agent_run_id=%s: %s",
                    agent_run_id,
                    exc,
                )
                return False

    results = await asyncio.gather(
        *(observe_one(agent_run_id) for agent_run_id in agent_run_ids)
    )
    return sum(results)


_sweep_task: asyncio.Task[None] | None = None


async def _sweep_loop(interval_seconds: float) -> None:
    while True:
        try:
            await observe_live_sessions()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("live terminal output sweep failed: %s", exc)
        await asyncio.sleep(interval_seconds)


async def start_live_output_sweep() -> None:
    """Begin observing live sessions on the durable ASGI lifespan loop."""

    global _sweep_task
    if _sweep_task is not None:
        return
    interval_seconds = sweep_interval_seconds()
    if interval_seconds is None:
        return
    _sweep_task = asyncio.create_task(_sweep_loop(interval_seconds))


async def stop_live_output_sweep() -> None:
    """Stop observing. Any in-flight capture is abandoned, not awaited."""

    global _sweep_task
    task = _sweep_task
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.warning("live terminal output sweep stopped unexpectedly: %s", exc)
    finally:
        _sweep_task = None
