"""Run-scoped Channels bus for committed Chat transcript events."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import threading

from channels.layers import get_channel_layer

from apps.runs.chat.contracts import ChatEventFrame, ChatEventRecord


logger = logging.getLogger(__name__)
_LOOPS_LOCK = threading.Lock()
_PUBLISH_LOOPS: dict[str, dict[asyncio.AbstractEventLoop, int]] = {}


def chat_group(agent_run_id: str) -> str:
    """Return a Channels-safe opaque group name for any durable run id."""

    digest = hashlib.sha256(agent_run_id.encode()).hexdigest()
    return f"chat.{digest}"


async def publish_chat_event(
    *,
    agent_run_id: str,
    event: ChatEventRecord,
) -> None:
    """Publish one already-committed transcript event to attached clients."""

    frame = ChatEventFrame(
        agent_run_id=agent_run_id,
        event=event,
    ).model_dump(mode="json")
    layer = get_channel_layer()
    await layer.group_send(
        chat_group(agent_run_id),
        {"type": "chat.event", "frame": frame},
    )


def register_publish_loop(
    agent_run_id: str,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Register the ASGI loop that owns this run's in-memory channel queues."""

    with _LOOPS_LOCK:
        loops = _PUBLISH_LOOPS.setdefault(agent_run_id, {})
        loops[loop] = loops.get(loop, 0) + 1


def unregister_publish_loop(
    agent_run_id: str,
    loop: asyncio.AbstractEventLoop,
) -> None:
    with _LOOPS_LOCK:
        loops = _PUBLISH_LOOPS.get(agent_run_id, {})
        remaining = loops.get(loop, 0) - 1
        if remaining > 0:
            loops[loop] = remaining
        else:
            loops.pop(loop, None)
        if not loops:
            _PUBLISH_LOOPS.pop(agent_run_id, None)


def _active_publish_loop(agent_run_id: str) -> asyncio.AbstractEventLoop | None:
    with _LOOPS_LOCK:
        loops = _PUBLISH_LOOPS.get(agent_run_id, {})
        stale = [loop for loop in loops if loop.is_closed()]
        for loop in stale:
            loops.pop(loop, None)
        if not loops:
            _PUBLISH_LOOPS.pop(agent_run_id, None)
            return None
        return next(iter(loops))


def publish_chat_event_sync(
    *,
    agent_run_id: str,
    event: ChatEventRecord,
) -> None:
    """Best-effort synchronous bridge used by Django ``on_commit`` hooks."""

    loop = _active_publish_loop(agent_run_id)
    if loop is None:
        # With no attached consumer, the durable row is the only required
        # output. A future connection obtains it from snapshot replay.
        return
    try:
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is loop:
            loop.create_task(
                publish_chat_event(
                    agent_run_id=agent_run_id,
                    event=event,
                )
            )
            return
        future = asyncio.run_coroutine_threadsafe(
            publish_chat_event(
                agent_run_id=agent_run_id,
                event=event,
            ),
            loop,
        )
        future.result(timeout=5)
    except Exception as exc:
        # The transcript row is authoritative. A reconnect replays it even if
        # this process-local live optimization is temporarily unavailable.
        logger.warning("failed to publish Chat event: %s", exc)
