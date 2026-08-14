"""Application policy for transient terminal viewers.

The terminal runtime owns only attachment mechanics.  This module owns the
outside decisions that surround those mechanics: durable viewer leases,
newest-viewer-wins arbitration, and process-local active-viewer bookkeeping.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from apps.terminals import viewer_leases
from apps.terminals.runtime import (
    TerminalAttachment,
    TerminalDimensions,
    TerminalRuntime,
    TmuxTerminalRuntime,
)


logger = logging.getLogger(__name__)


@dataclass
class ViewerAttachment:
    agent_run_id: str
    viewer_id: str
    attachment: TerminalAttachment
    _released: bool = False

    def release(self) -> None:
        """Detach this viewer and release only its own ownership claim."""

        if self._released:
            return
        self._released = True
        try:
            self.attachment.detach()
        finally:
            _release(self)

    def detach_replaced_mechanics(self) -> None:
        """Detach a duplicate identity while preserving its renewed lease."""

        if self._released:
            return
        self._released = True
        self.attachment.detach()


_runtime: TerminalRuntime = TmuxTerminalRuntime()
_active: dict[str, ViewerAttachment] = {}
_lock = threading.RLock()


def configure_runtime(runtime: TerminalRuntime) -> None:
    """Replace the runtime used for future attachments (primarily a test seam)."""

    global _runtime
    _runtime = runtime


def active_count() -> int:
    with _lock:
        return len(_active)


def acquire(
    *,
    agent_run_id: str,
    viewer_id: str,
    dimensions: TerminalDimensions,
    transport: str = "browser",
) -> ViewerAttachment:
    """Create and authorize one viewer, displacing the previous viewer.

    Mechanical attachment happens before ownership changes, so a failed
    replacement never evicts a working viewer.  Once the new attachment is
    ready, the lease and in-process registry move together and the displaced
    transient client is detached without touching the durable terminal.
    """

    attachment = _runtime.attach(agent_run_id)
    try:
        attachment.resize(dimensions)
    except Exception:
        attachment.detach()
        raise

    viewer = ViewerAttachment(agent_run_id, viewer_id, attachment)
    try:
        with _lock:
            viewer_leases.acquire(
                agent_run_id=agent_run_id,
                viewer_id=viewer_id,
                transport=transport,
            )
            displaced = _active.get(agent_run_id)
            _active[agent_run_id] = viewer
            if displaced is not None:
                if displaced.viewer_id == viewer_id:
                    # A retried acquisition with the same policy identity already
                    # owns the renewed lease. Detach only its superseded mechanics
                    # so the release cannot delete the lease just acquired above.
                    displaced.detach_replaced_mechanics()
                else:
                    displaced.release()
    except Exception:
        attachment.detach()
        raise
    return viewer


def renew(viewer: ViewerAttachment) -> bool:
    """Return whether this viewer still owns the outside lease."""

    with _lock:
        if _active.get(viewer.agent_run_id) is not viewer:
            return False
    return (
        viewer_leases.renew(
            agent_run_id=viewer.agent_run_id,
            viewer_id=viewer.viewer_id,
        )
        is not None
    )


def _release(viewer: ViewerAttachment) -> None:
    with _lock:
        if _active.get(viewer.agent_run_id) is viewer:
            _active.pop(viewer.agent_run_id, None)
    try:
        viewer_leases.release(
            agent_run_id=viewer.agent_run_id,
            viewer_id=viewer.viewer_id,
        )
    except Exception:
        logger.warning(
            "terminal viewer lease release failed agent_run_id=%s viewer_id=%s",
            viewer.agent_run_id,
            viewer.viewer_id,
            exc_info=True,
        )


def clear() -> None:
    """Detach all transient viewers without terminating durable runtimes."""

    with _lock:
        viewers = list(_active.values())
        _active.clear()
    for viewer in viewers:
        viewer.release()
