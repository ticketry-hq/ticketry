"""Low-level tmux primitives shared across the package.

The dedicated socket, session-naming, existence check, and the single error
type every other tmux submodule builds on.
"""

from __future__ import annotations

import os
from pathlib import Path

import libtmux


# Dedicated socket isolates prototype from user's tmux.

TMUX_SOCKET = "muxed"

# Session-name prefix used by every Muxed session.

SESSION_PREFIX = "pt-"
_APPROVED_TMUX_ENV = "MUXED_APPROVED_TMUX_PATH"


class TmuxSessionError(RuntimeError):
    """Raised when a tmux/libtmux operation fails.

    Wraps the underlying ``LibTmuxException`` or tmux stderr so callers
    in higher layers can translate it into HTTP/WebSocket responses.
    """


def tmux_executable() -> str:
    """Return the Rust-approved tmux path for a packaged launch.

    Browser development deliberately retains the normal ``tmux`` fallback.
    Packaged Tauri launches set this value and a bounded PATH before the
    sidecar starts, so neither terminal attachment nor libtmux can inherit an
    interactive shell's command resolution.
    """

    approved = os.getenv(_APPROVED_TMUX_ENV)
    if approved is None:
        return "tmux"
    path = Path(approved)
    if not path.is_absolute() or path.name != "tmux":
        raise TmuxSessionError("desktop supplied an invalid approved tmux path")
    return str(path)


def _server() -> libtmux.Server:
    """Return a libtmux server bound to the dedicated Muxed socket."""

    return libtmux.Server(socket_name=TMUX_SOCKET)


def _session_name(agent_run_id: str) -> str:
    """Format the tmux session name for an agent run id."""

    return f"{SESSION_PREFIX}{agent_run_id}"


def _has_session(server: libtmux.Server, name: str) -> bool:
    """Return True if a session with ``name`` exists on the socket.

    Uses ``tmux has-session`` directly; libtmux's high-level
    ``Server.sessions`` raises when no server is running, which we
    treat as "no such session" rather than an error.
    """

    res = server.cmd("has-session", "-t", name)
    return res.returncode == 0
