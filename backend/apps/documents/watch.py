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
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from watchfiles import Change, awatch

from apps.documents import design_docs
from apps.documents.service import doc_payload, upsert_document

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
    row, created = await upsert_document(
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


def start_watch(
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
    )
    _WATCHES[agent_run_id] = _Watch(task, stop_event)
    return True


def stop_watch(agent_run_id: str) -> None:
    """Stop a run's watcher; idempotent for unknown/already-stopped runs."""

    watch = _WATCHES.pop(agent_run_id, None)
    if watch is None:
        return
    watch.stop_event.set()


def stop_all() -> None:
    """Stop every active watcher (app shutdown)."""

    for run_id in list(_WATCHES):
        stop_watch(run_id)
