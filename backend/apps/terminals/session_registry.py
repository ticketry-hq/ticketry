"""Process-private terminal-session registry and tmux viewer ownership.

Holds the in-process bookkeeping the WebSocket consumer shares across all live
connections: the :class:`PtySession` wrapper around a spawned PTY, the
``SESSIONS`` registry keyed by session id, and the ``TMUX_VIEWERS`` map that
tracks the current viewer PTY for each tmux-backed run.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Optional

import ptyprocess


@dataclass
class PtySession:
    session_id: str
    pty: ptyprocess.PtyProcessUnicode
    agent: str
    task_id: Optional[str]
    module_id: str
    agent_run_id: Optional[str] = None
    project_id: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def setwinsize(self, rows: int, cols: int) -> None:
        self.pty.setwinsize(rows, cols)

    def write(self, data: str) -> None:
        self.pty.write(data)

    def read(self, n: int = 4096) -> str:
        return self.pty.read(n)

    def terminate(self, force: bool = True) -> None:
        try:
            self.pty.terminate(force=force)
        except Exception:
            pass


# Process-private session registry and tmux viewer ownership.

SESSIONS: dict[str, PtySession] = {}
TMUX_VIEWERS: dict[str, str] = {}
_tmux_viewers_sync_lock = threading.Lock()


def _replace_tmux_viewer_sync(session: PtySession) -> PtySession | None:
    """Register ``session`` as viewer and return any displaced live session."""

    with _tmux_viewers_sync_lock:
        previous_id = TMUX_VIEWERS.get(session.agent_run_id)
        TMUX_VIEWERS[session.agent_run_id] = session.session_id
        SESSIONS[session.session_id] = session
        if previous_id is None or previous_id == session.session_id:
            return None
        return SESSIONS.get(previous_id)


def _release_tmux_viewer_sync(agent_run_id: Optional[str], session_id: str) -> None:
    if not agent_run_id:
        return
    with _tmux_viewers_sync_lock:
        if TMUX_VIEWERS.get(agent_run_id) == session_id:
            TMUX_VIEWERS.pop(agent_run_id, None)
