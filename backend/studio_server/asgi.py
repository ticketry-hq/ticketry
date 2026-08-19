import asyncio
import inspect
import logging
import os
from math import isfinite

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application


logger = logging.getLogger(__name__)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "studio_server.settings")

startup_callables = []
shutdown_callables = []


def register_startup(fn):
    """Register a callable for ASGI startup."""
    startup_callables.append(fn)


def register_shutdown(fn):
    """Register a callable for ASGI shutdown."""
    shutdown_callables.append(fn)


async def _run(callables):
    """Run registered synchronous or asynchronous callables."""
    for fn in callables:
        result = fn()
        if inspect.isawaitable(result):
            await result


django_asgi_app = get_asgi_application()

from studio_server.routing import websocket_urlpatterns

from apps.execution import transition_occurrence_scheduler
from apps.runs import hook_spool
from apps.terminals.reconciliation import reconcile_terminals


# There is no design-directory watcher to stop. Live document discovery moved to
# the Rust watcher supervisor at the Slice 4 handoff, and it is stopped by the
# desktop shell that owns it.

register_startup(hook_spool.start)
register_shutdown(hook_spool.stop)
register_startup(transition_occurrence_scheduler.start)
register_shutdown(transition_occurrence_scheduler.stop)


# No worktree reconciliation is registered here either. Rust owns the Worktree
# index and reconciles it from the durable Workspace Operation journal plus Git's
# own evidence, which can distinguish an operation that never began from one that
# changed Git and was not acknowledged. This startup pass could only prune, so
# keeping it would leave a second writer whose only move is to delete.


async def _validate_provider_catalog() -> None:
    """Refuse readiness when persisted providers and executable adapters drift."""

    from apps.terminals.agents.registry import all_slugs
    from worktracker.services.provider_catalog import (
        assert_provider_catalog_matches_adapters,
    )

    await asyncio.to_thread(assert_provider_catalog_matches_adapters, all_slugs())


register_startup(_validate_provider_catalog)


async def _reap_dead_terminal_sessions() -> None:
    """Reconcile terminal records with runtime observations after downtime.

    Best-effort: a reaper failure is logged but never blocks startup.
    """

    try:
        await asyncio.to_thread(reconcile_terminals)
    except Exception as exc:
        logger.warning("startup terminal reconcile failed: %s", exc)


register_startup(_reap_dead_terminal_sessions)


_idle_terminal_reaper_task: asyncio.Task[None] | None = None


def _idle_terminal_sweep_seconds() -> float | None:
    raw_value = os.environ.get("MUXED_IDLE_SWEEP_MINUTES", "30")
    try:
        minutes = float(raw_value)
    except (TypeError, ValueError):
        return None
    if minutes <= 0 or not isfinite(minutes):
        return None
    return minutes * 60.0


async def _idle_terminal_sweep_loop(interval_seconds: float) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.to_thread(reconcile_terminals)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("idle terminal sweep failed: %s", exc)


async def _start_idle_terminal_sweep() -> None:
    global _idle_terminal_reaper_task
    if _idle_terminal_reaper_task is not None:
        return
    interval_seconds = _idle_terminal_sweep_seconds()
    if interval_seconds is None:
        return
    _idle_terminal_reaper_task = asyncio.create_task(
        _idle_terminal_sweep_loop(interval_seconds)
    )


async def _stop_idle_terminal_sweep() -> None:
    global _idle_terminal_reaper_task
    task = _idle_terminal_reaper_task
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.warning("idle terminal sweep stopped unexpectedly: %s", exc)
    finally:
        _idle_terminal_reaper_task = None


register_startup(_start_idle_terminal_sweep)
register_shutdown(_stop_idle_terminal_sweep)

router = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    },
)


async def application(scope, receive, send):
    """Route ASGI traffic and handle optional lifespan events."""
    if scope["type"] != "lifespan":
        await router(scope, receive, send)
        return

    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            await _run(startup_callables)
            await send({"type": "lifespan.startup.complete"})
        elif message["type"] == "lifespan.shutdown":
            await _run(shutdown_callables)
            await send({"type": "lifespan.shutdown.complete"})
            return
