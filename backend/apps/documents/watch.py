"""Per-run design-directory watcher (ticket #521).

Watches one registered design directory per active agent run, recursively,
and turns HTML/Markdown file creations and rewrites into:

- a ``design_documents`` registry upsert (durable across restarts), and
- a ``document`` frame on the module's lifecycle bus so an open workspace
  shows the tab immediately.

Key characteristics:

- One asyncio task per run, started after the run row is persisted and
  stopped when the run is terminated or the app shuts down.
- ``watchfiles.awatch`` batches raw events; a per-path suppression window
  keeps a streamed file write from emitting a frame per chunk.
- Discovery durability is owned by the restore-rescan, so a watcher lost to
  a backend restart is never resurrected.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import uuid
from concurrent.futures import Future
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from watchfiles import Change, awatch

from apps.documents import dao, design_docs
from apps.documents.service import doc_payload

logger = logging.getLogger(__name__)

# Suppression window: further events for the same path inside it are folded
# into the one already relayed.

DEBOUNCE_SECONDS = 0.3


class _Watch:
    """Bookkeeping for one run's watcher task."""

    def __init__(self, task: asyncio.Task, stop_event: asyncio.Event) -> None:
        self.task = task
        self.stop_event = stop_event


_WATCHES: Dict[str, _Watch] = {}
_OWNER_LOOP: asyncio.AbstractEventLoop | None = None
_OWNER_CONTEXT: contextvars.Context | None = None


def _watch_done(agent_run_id: str, task: asyncio.Task) -> None:
    """Forget a completed watcher and report unexpected loop failures."""

    current = _WATCHES.get(agent_run_id)
    if current is not None and current.task is task:
        _WATCHES.pop(agent_run_id, None)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.warning("design doc watcher stopped run=%s: %s", agent_run_id, error)


async def startup() -> None:
    """Bind watcher tasks to the backend's long-lived ASGI event loop."""

    global _OWNER_CONTEXT, _OWNER_LOOP
    _OWNER_LOOP = asyncio.get_running_loop()
    _OWNER_CONTEXT = contextvars.copy_context()


async def shutdown() -> None:
    """Stop and join every watcher before releasing the ASGI event loop."""

    global _OWNER_CONTEXT, _OWNER_LOOP
    watches = list(_WATCHES.values())
    stop_all()
    if watches:
        await asyncio.gather(*(watch.task for watch in watches), return_exceptions=True)
    _OWNER_LOOP = None
    _OWNER_CONTEXT = None


async def _register_document(
    *,
    agent_run_id: Optional[str],
    module_id: str,
    task_id: str,
    scope: str,
    root: Path,
    rel_path: str,
    publish,
) -> None:
    """Upsert one discovered document and relay a typed frame.

    :param agent_run_id: originating run for provenance, ``None`` on rescan.
    :param module_id: workspace owner, also carried inside the frame.
    :param task_id: work-item id or the scratch sentinel.
    :param scope: ``task`` / ``plan`` / ``instant``.
    :param root: absolute registered design directory.
    :param rel_path: document path relative to ``root``.
    :param publish: async single-argument document-frame publisher.
    """

    now = datetime.now(timezone.utc).isoformat()
    row, created = await dao.upsert_document(
        doc_id=uuid.uuid4().hex,
        module_id=module_id,
        task_id=task_id,
        scope=scope,
        root_dir=str(root),
        rel_path=rel_path,
        discovered_by_run_id=agent_run_id,
        now=now,
    )

    await publish(
        {
            "type": "document",
            "event": "created" if created else "updated",
            "task_id": task_id,
            "module_id": module_id,
            "doc": doc_payload(row),
        }
    )


async def _watch_loop(
    *,
    agent_run_id: str,
    design_dir: Path,
    module_id: str,
    task_id: str,
    scope: str,
    stop_event: asyncio.Event,
    publish,
) -> None:
    """Drain watchfiles batches for one design directory until stopped."""

    boundary = design_dir.resolve()
    last_seen: Dict[str, float] = {}
    loop = asyncio.get_running_loop()

    async for changes in awatch(design_dir, stop_event=stop_event):
        for change, raw_path in changes:
            if change not in (Change.added, Change.modified):
                continue
            path = Path(raw_path)
            if (
                path.suffix.lower() not in design_docs.DOCUMENT_EXTENSIONS
                or not path.is_file()
            ):
                continue

            # Containment after symlink resolution; escapes are not servable.

            try:
                resolved = path.resolve()
                resolved.relative_to(boundary)
            except (ValueError, OSError):
                continue
            rel_path = resolved.relative_to(boundary).as_posix()

            # Fold a streamed write's event burst into one relayed frame.

            now = loop.time()
            if now - last_seen.get(rel_path, -DEBOUNCE_SECONDS) < DEBOUNCE_SECONDS:
                continue
            last_seen[rel_path] = now

            try:
                await _register_document(
                    agent_run_id=agent_run_id,
                    module_id=module_id,
                    task_id=task_id,
                    scope=scope,
                    root=boundary,
                    rel_path=rel_path,
                    publish=publish,
                )
            except Exception as exc:
                logger.warning(
                    "design doc registration failed (run=%s, path=%s): %s",
                    agent_run_id,
                    rel_path,
                    exc,
                )


def _start_watch_on_current_loop(
    *,
    agent_run_id: str,
    design_dir: Optional[str],
    module_id: str,
    task_id: str,
    scope: str,
    publish,
) -> bool:
    """Start the design-directory watcher for one run.

    No-op (returns ``False``) when the run has no design directory or the
    directory is missing, and when a watcher is already running for the run.

    :param agent_run_id: the run the watcher belongs to.
    :param design_dir: absolute registered design directory, or ``None``.
    :param module_id: bus topic for relayed frames.
    :param task_id: work-item id or the scratch sentinel.
    :param scope: ``task`` / ``plan`` / ``instant``.
    :param publish: async single-argument document-frame publisher.
    :return: ``True`` when a watcher task was started.
    """

    if not design_dir or agent_run_id in _WATCHES:
        return False
    root = Path(design_dir)
    if not root.is_dir():
        return False

    stop_event = asyncio.Event()
    task_context = (
        _OWNER_CONTEXT.copy()
        if _OWNER_LOOP is asyncio.get_running_loop() and _OWNER_CONTEXT is not None
        else None
    )
    task = asyncio.create_task(
        _watch_loop(
            agent_run_id=agent_run_id,
            design_dir=root,
            module_id=module_id,
            task_id=task_id,
            scope=scope,
            stop_event=stop_event,
            publish=publish,
        ),
        name=f"design-watch-{agent_run_id[:8]}",
        context=task_context,
    )
    task.add_done_callback(lambda completed: _watch_done(agent_run_id, completed))
    _WATCHES[agent_run_id] = _Watch(task, stop_event)
    return True


async def _start_watch_on_owner(**kwargs) -> bool:
    return _start_watch_on_current_loop(**kwargs)


def start_watch(
    *,
    agent_run_id: str,
    design_dir: Optional[str],
    module_id: str,
    task_id: str,
    scope: str,
    publish,
) -> bool:
    """Start a watcher on the backend-owned loop, regardless of caller context.

    Programmatic launches enter async code through ``async_to_sync``. The event
    loop created for that bridge is destroyed as soon as launch returns, so a
    watcher attached to it cannot survive long enough to observe agent writes.
    ASGI startup records its durable lifespan loop; foreign launch loops hand
    watcher creation back to that owner before returning.
    """

    kwargs = {
        "agent_run_id": agent_run_id,
        "design_dir": design_dir,
        "module_id": module_id,
        "task_id": task_id,
        "scope": scope,
        "publish": publish,
    }
    owner = _OWNER_LOOP
    if owner is not None and owner.is_running():
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        if current is not owner:
            future: Future[bool] = asyncio.run_coroutine_threadsafe(
                _start_watch_on_owner(**kwargs), owner
            )
            return future.result()
    return _start_watch_on_current_loop(**kwargs)


def stop_watch(agent_run_id: str) -> None:
    """Stop a run's watcher; idempotent for unknown/already-stopped runs."""

    owner = _OWNER_LOOP
    if owner is not None and owner.is_running():
        try:
            current = asyncio.get_running_loop()
        except RuntimeError:
            current = None
        if current is not owner:
            owner.call_soon_threadsafe(_stop_watch_on_current_loop, agent_run_id)
            return
    _stop_watch_on_current_loop(agent_run_id)


def _stop_watch_on_current_loop(agent_run_id: str) -> None:
    """Stop one watcher while executing on its owning event loop."""

    watch = _WATCHES.pop(agent_run_id, None)
    if watch is None:
        return
    watch.stop_event.set()


def stop_all() -> None:
    """Stop every active watcher (app shutdown)."""

    for run_id in list(_WATCHES):
        stop_watch(run_id)
