"""One-shot application input for an already-running tmux pane."""

from __future__ import annotations

import os
import tempfile
import time
import uuid

from apps.terminals.tmux._core import TmuxSessionError, _server, _session_name


_INLINE_BUFFER_MAX_BYTES = 8 * 1024
_INPUT_VISIBLE_TIMEOUT_SECONDS = 2.0
_INPUT_VISIBLE_POLL_SECONDS = 0.01
_VISIBLE_TAIL_CHARACTERS = 64
_PASTE_SETTLE_SECONDS = 0.15
_COMPLETION_SETTLE_SECONDS = 0.05


def _require_success(result, operation: str) -> None:
    if result.returncode == 0:
        return
    stderr = "\n".join(result.stderr or [])
    raise TmuxSessionError(f"{operation} failed: {stderr}")


def _wait_until_input_is_visible(server, target: str, text: str) -> None:
    normalized_text = " ".join(text.split())
    expected_tail = normalized_text[-_VISIBLE_TAIL_CHARACTERS:]
    deadline = time.monotonic() + _INPUT_VISIBLE_TIMEOUT_SECONDS
    while True:
        captured = server.cmd("capture-pane", "-p", "-J", "-t", target)
        _require_success(captured, "terminal input confirmation")
        screen = " ".join("\n".join(captured.stdout or []).split())
        if expected_tail in screen:
            return
        if time.monotonic() >= deadline:
            raise TmuxSessionError("terminal input did not become visible")
        time.sleep(_INPUT_VISIBLE_POLL_SECONDS)


def _stage_text(server, target: str, text: str) -> None:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("terminal message must be a non-empty str")
    payload = text.encode("utf-8")
    buffer_name = f"ticketry-{uuid.uuid4().hex}"

    if len(payload) <= _INLINE_BUFFER_MAX_BYTES:
        _require_success(
            server.cmd("set-buffer", "-b", buffer_name, "--", text),
            "prompt buffer creation",
        )
    else:
        descriptor, path = tempfile.mkstemp(prefix="ticketry-prompt-")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(payload)
            _require_success(
                server.cmd("load-buffer", "-b", buffer_name, path),
                "prompt buffer load",
            )
        finally:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass

    _require_success(
        server.cmd(
            "paste-buffer",
            "-d",
            "-p",
            "-r",
            "-b",
            buffer_name,
            "-t",
            target,
        ),
        "prompt buffer paste",
    )

    _wait_until_input_is_visible(server, target, text)


def stage_text(agent_run_id: str, text: str) -> None:
    """Insert text into the hosted terminal without pressing Enter."""

    _stage_text(_server(), _session_name(agent_run_id), text)


def submit_text(agent_run_id: str, text: str) -> None:
    """Insert one message verbatim and press Enter.

    Every message uses bracketed paste so a TUI can distinguish the completed
    payload from a rapid stream of keystrokes. Large messages load the buffer
    from a file so tmux's control-message limit cannot truncate them.
    """

    target = _session_name(agent_run_id)
    server = _server()
    _stage_text(server, target, text)

    # Give paste-burst suppression time to expire before pressing Enter. Skill
    # completion menus consume the first Enter to accept the selected skill,
    # so a second Enter submits the completed one-line invocation. An empty
    # second Enter is harmless for providers that submitted on the first.
    time.sleep(_PASTE_SETTLE_SECONDS)
    _require_success(
        server.cmd("send-keys", "-t", target, "Enter"),
        "prompt completion confirmation",
    )
    time.sleep(_COMPLETION_SETTLE_SECONDS)
    _require_success(
        server.cmd("send-keys", "-t", target, "Enter"),
        "prompt submission",
    )
