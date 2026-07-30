"""Attached-client control: attach argv, scroll, resize.

Drives an *already-running* session's client view. No session is created or
persisted here; these are the operations the WebSocket consumer issues while a
PTY is bridged to a session.
"""

from __future__ import annotations

from apps.terminals.tmux._core import (
    TmuxSessionError,
    _server,
    _session_name,
    tmux_executable,
    tmux_socket,
)


def attach_argv(agent_run_id: str) -> list[str]:
    """Return the argv used to attach a PTY to the run's session.

    No PTY is spawned here; the consumer's spawn/attach path consumes this argv.
    """

    return [
        tmux_executable(),
        "-L",
        tmux_socket(),
        "attach",
        "-t",
        _session_name(agent_run_id),
    ]


def scroll(agent_run_id: str, direction: str, lines: int = 3) -> None:
    """Scroll a session's tmux copy-mode scrollback by ``lines`` (#578).

    The browser bridges mouse-wheel/trackpad ticks here instead of letting
    xterm translate them into cursor keys. tmux ``mouse`` mode stays off so
    click-drag text selection keeps working in xterm; we drive copy-mode
    directly:

    - Entering copy-mode with ``-e`` makes a downward scroll past the bottom
      exit the mode automatically, so the view returns to the live prompt.
    - ``-H`` (tmux 3.6+) hides tmux's copy-mode position marker without
      changing the session or the user's global tmux configuration.
    - ``scroll-up`` / ``scroll-down`` move ``lines`` rows per call.

    :param agent_run_id: run whose tmux session should scroll.
    :param direction: ``"up"`` (into history) or ``"down"`` (toward prompt).
    :param lines: number of rows to move; clamped to a sane range.
    :raises TmuxSessionError: if the tmux commands fail for a live session.
    """

    if direction not in ("up", "down"):
        raise TmuxSessionError(f"bad scroll direction: {direction!r}")
    lines = max(1, min(int(lines), 500))
    name = _session_name(agent_run_id)
    server = _server()

    # Enter (or stay in) copy-mode with exit-on-bottom semantics and no tmux
    # position marker. Ticketry targets tmux 3.6+'s -H capability explicitly
    # rather than mutating users' global tmux configuration. Idempotent:
    # re-issuing copy-mode while already in it is a no-op for our purposes.

    enter = server.cmd("copy-mode", "-e", "-H", "-t", name)
    if enter.returncode != 0:
        stderr = "\n".join(enter.stderr or [])
        raise TmuxSessionError(f"copy-mode failed for {name!r}: {stderr}")

    cmd = "scroll-up" if direction == "up" else "scroll-down"
    res = server.cmd("send-keys", "-t", name, "-X", "-N", str(lines), cmd)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(f"send-keys {cmd} failed for {name!r}: {stderr}")


def refresh_client_size(agent_run_id: str, cols: int, rows: int) -> None:
    """Resize the attached tmux client for ``agent_run_id``.

    The browser supplies geometry in xterm order (columns, rows). tmux's
    control resize flag expects ``<cols>x<rows>`` against the session target.
    """

    name = _session_name(agent_run_id)
    server = _server()
    res = server.cmd("refresh-client", "-t", name, "-C", f"{cols}x{rows}")
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        if "can't find client" in stderr:
            fallback = server.cmd(
                "resize-window",
                "-t",
                name,
                "-x",
                str(cols),
                "-y",
                str(rows),
            )
            if fallback.returncode == 0:
                return
            fallback_stderr = "\n".join(fallback.stderr or [])
            stderr = f"{stderr}; resize-window fallback failed: {fallback_stderr}"
        raise TmuxSessionError(f"refresh-client failed for {name!r}: {stderr}")
