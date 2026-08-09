"""Low-level tmux primitives shared across the package.

The dedicated socket, session-naming, existence check, and the single error
type every other tmux submodule builds on.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import libtmux


# Dedicated socket isolates Ticketry from the user's tmux. Desktop development
# further scopes it to the isolated data-directory identity so another
# worktree's reconciler cannot mistake this profile's sessions for orphans.

TMUX_SOCKET = "muxed"
_TMUX_SOCKET_ENV = "MUXED_TMUX_SOCKET"

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


def tmux_socket() -> str:
    """Return the application-owned tmux socket name for this profile."""

    socket = os.getenv(_TMUX_SOCKET_ENV) or TMUX_SOCKET
    if (
        not socket
        or len(socket) > 64
        or any(
            not (character.isalnum() or character in "-_")
            for character in socket
        )
    ):
        raise TmuxSessionError("desktop supplied an invalid tmux socket name")
    return socket


def tmux_runtime_namespace() -> str:
    """Return an opaque identity for the effective tmux socket endpoint.

    ``tmux -L`` resolves a socket name underneath ``TMUX_TMPDIR`` (or
    ``/tmp``).  Persisting only the name lets two processes with different
    socket roots claim the same runtime inventory and reconcile each other's
    live sessions as missing.  Hash the complete endpoint identity so the
    application can compare ownership without persisting private paths.
    """

    socket_root = Path(os.environ.get("TMUX_TMPDIR") or "/tmp")
    normalized_root = socket_root.expanduser().resolve(strict=False)
    endpoint = f"{normalized_root}\0{os.getuid()}\0{tmux_socket()}"
    digest = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:32]
    return f"tmux-{digest}"


def _server() -> libtmux.Server:
    """Return a libtmux server bound to the dedicated Muxed socket."""

    return libtmux.Server(socket_name=tmux_socket())


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
