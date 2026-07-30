"""Integration tests for ``terminals/tmux.py``.

Each test creates and tears down its own tmux session on the dedicated
``Muxed`` socket and is skipped (not failed) if ``tmux`` is missing
from ``PATH``. Metadata persistence is checked against the Django ORM.
"""

from __future__ import annotations

import os
import select
import shutil
import subprocess
import tempfile
import time
import uuid

import ptyprocess
import pytest

from apps.runs.models import AgentRun
from apps.terminals.tmux import sessions as tmux
from apps.terminals.tmux._core import (
    SESSION_PREFIX,
    TMUX_SOCKET,
    TmuxSessionError,
    _server,
)
from apps.terminals.tmux.client import attach_argv, refresh_client_size, scroll
from apps.terminals.tmux.metadata import TmuxSession, _parse_show_options
from apps.terminals.models import AgentTerminalSession


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux binary not on PATH"),
]


def _run_id() -> str:
    # Unique id per test isolates concurrent test sessions on the socket.

    return f"test-{uuid.uuid4().hex[:12]}"


@pytest.fixture(autouse=True)
def isolated_tmux_socket(monkeypatch):
    """Keep real-tmux tests away from a developer's live Ticketry sessions.

    Finder-launched macOS applications do not reliably inherit locale
    variables.  Exercise that production environment on every integration
    test so session creation never regresses to libtmux's locale-sensitive
    formatted-object lookup.
    """

    socket_root = tempfile.mkdtemp(prefix="ticketry-test-tmux-", dir="/private/tmp")
    monkeypatch.setenv("TMUX_TMPDIR", socket_root)
    monkeypatch.delenv("TMUX", raising=False)
    for name in ("LANG", "LC_ALL", "LC_CTYPE"):
        monkeypatch.delenv(name, raising=False)
    try:
        yield
    finally:
        subprocess.run(
            ["tmux", "-L", TMUX_SOCKET, "kill-server"],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        shutil.rmtree(socket_root, ignore_errors=True)


@pytest.fixture
def agent_run_id():
    rid = _run_id()

    # A parent run row must exist for the terminal-session FK.

    AgentRun.objects.create(
        id=rid,
        workspace_slug="meml",
        project_id="project-789",
        module_id="module-456",
        task_id="task-123",
        ticket_seq=484,
        agent="claude-code",
        status="running",
        started_at="2026-05-29T10:00:00",
        cwd="/tmp",
    )
    yield rid

    # Best-effort cleanup; ignore if already terminated by the test.

    try:
        tmux.terminate_session(rid)
    except TmuxSessionError:
        pass


def _make(rid: str, command: str = "sleep 60") -> TmuxSession:
    return tmux.create_session(
        agent_run_id=rid,
        task_id="task-123",
        module_id="module-456",
        project_id="project-789",
        agent="claude-code",
        command=command,
        cwd="/tmp",
    )


def _read_available_pty_bytes(
    viewer: ptyprocess.PtyProcessUnicode, timeout: float = 0.25
) -> bytes:
    output = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([viewer.fileno()], [], [], 0.02)
        if ready:
            output.extend(os.read(viewer.fileno(), 65536))
    return bytes(output)


def test_create_session_returns_populated_dataclass_and_is_listed(agent_run_id):
    session = _make(agent_run_id)

    assert session.name == f"pt-{agent_run_id}"
    assert session.agent_run_id == agent_run_id
    assert session.task_id == "task-123"
    assert session.module_id == "module-456"
    assert session.project_id == "project-789"
    assert session.agent == "claude-code"
    assert session.scope == "task"
    assert session.created_at.tzinfo is not None

    listed = tmux.list_sessions()
    assert any(s.name == session.name for s in listed)


def test_create_session_persists_metadata(agent_run_id):
    _make(agent_run_id)

    row = AgentTerminalSession.objects.get(agent_run_id=agent_run_id)

    assert row.tmux_session_name == f"pt-{agent_run_id}"
    assert row.task_id == "task-123"
    assert row.terminated_at is None


def test_user_options_round_trip_through_get_session(agent_run_id):
    created = _make(agent_run_id)
    fetched = tmux.get_session(agent_run_id)

    assert fetched is not None
    assert fetched.name == created.name
    assert fetched.agent_run_id == created.agent_run_id
    assert fetched.task_id == created.task_id
    assert fetched.module_id == created.module_id
    assert fetched.project_id == created.project_id
    assert fetched.agent == created.agent

    # tmux stores ISO8601 to the microsecond; equality is round-trip safe.

    assert fetched.created_at == created.created_at


def test_scope_round_trips_through_get_session(agent_run_id):
    created = tmux.create_session(
        agent_run_id=agent_run_id,
        task_id="00000000-0000-0000-0000-000000000000",
        module_id="module-456",
        project_id="project-789",
        agent="claude-code",
        command="sleep 60",
        cwd="/tmp",
        scope="plan",
    )
    fetched = tmux.get_session(agent_run_id)

    assert created.scope == "plan"
    assert fetched is not None
    assert fetched.scope == "plan"


def test_doc_rel_path_round_trips_through_get_session(agent_run_id):
    """A doc-chat run's @pt-doc-path survives a backend restart (#625)."""
    created = tmux.create_session(
        agent_run_id=agent_run_id,
        task_id="task-123",
        module_id="module-456",
        project_id="project-789",
        agent="claude-code",
        command="sleep 60",
        cwd="/tmp",
        scope="docchat",
        doc_rel_path="spec/x/LLD.html",
    )
    fetched = tmux.get_session(agent_run_id)

    assert created.scope == "docchat"
    assert created.doc_rel_path == "spec/x/LLD.html"
    assert fetched is not None
    assert fetched.scope == "docchat"
    assert fetched.doc_rel_path == "spec/x/LLD.html"
    # And it is persisted on the mirror row.
    row = AgentTerminalSession.objects.get(agent_run_id=agent_run_id)
    assert row.doc_rel_path == "spec/x/LLD.html"


def test_non_doc_chat_session_has_null_doc_path(agent_run_id):
    """A normal run never stamps a doc path (option absent → None)."""
    _make(agent_run_id)
    fetched = tmux.get_session(agent_run_id)
    assert fetched is not None
    assert fetched.doc_rel_path is None


def test_create_session_leaves_mouse_mode_off(agent_run_id):
    """Mouse mode stays off so xterm keeps native text selection (#578).

    Scroll is bridged via :func:`tmux.scroll` instead of tmux mouse mode,
    which would otherwise claim click-drag and break selection.
    """

    session = _make(agent_run_id)

    server = _server()
    res = server.cmd("show-options", "-t", session.name, "mouse")
    opts = _parse_show_options(list(res.stdout or []))

    # Unset (default off) or explicitly off — never on.
    assert opts.get("mouse", "off") != "on"


def test_create_session_disables_status_line(agent_run_id):
    session = _make(agent_run_id)

    server = _server()
    res = server.cmd("show-options", "-t", session.name, "status")
    opts = _parse_show_options(list(res.stdout or []))

    assert opts["status"] == "off"


def test_create_session_retains_provider_pane_after_exit(agent_run_id):
    session = tmux.create_session(
        agent_run_id=agent_run_id,
        task_id="task-123",
        module_id="module-456",
        project_id="project-789",
        agent="codex",
        command="exit 7",
        cwd="/tmp",
    )

    server = _server()
    options = server.cmd("show-options", "-wv", "-t", session.name, "remain-on-exit")
    assert (options.stdout or []) == ["on"]

    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        panes = server.cmd("list-panes", "-t", session.name, "-F", "#{pane_dead}")
        if (panes.stdout or []) == ["1"]:
            break
        time.sleep(0.02)
    else:
        pytest.fail("provider pane did not become dead")

    # The session is still available for reconciliation to classify.
    assert tmux.get_session(agent_run_id) is not None


def test_reconcile_classifies_retained_dead_pane_as_exited(agent_run_id):
    session = tmux.create_session(
        agent_run_id=agent_run_id,
        task_id="task-123",
        module_id="module-456",
        project_id="project-789",
        agent="codex",
        command="sleep 0.1; exit 7",
        cwd="/tmp",
    )
    server = _server()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        panes = server.cmd("list-panes", "-t", session.name, "-F", "#{pane_dead}")
        if (panes.stdout or []) == ["1"]:
            break
        time.sleep(0.02)
    else:
        pytest.fail("provider pane did not become dead")

    result = tmux.reconcile_sessions()

    assert result.exited == [agent_run_id]
    assert result.soft_deleted == []
    assert (
        AgentTerminalSession.objects.get(agent_run_id=agent_run_id).terminated_at
        is not None
    )
    assert tmux.get_session(agent_run_id) is None


def test_reconcile_preserves_untracked_live_session():
    name = f"pt-orphan-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        [
            "tmux",
            "-L",
            TMUX_SOCKET,
            "new-session",
            "-d",
            "-s",
            name,
            "sleep 60",
        ],
        check=True,
    )
    try:
        server = _server()
        assert name in tmux._live_session_births(server)

        result = tmux.reconcile_sessions()

        assert result.untracked == [name]
        assert name in tmux._live_session_births(server)
    finally:
        subprocess.run(
            ["tmux", "-L", TMUX_SOCKET, "kill-session", "-t", name],
            check=False,
        )


def test_reconcile_preserves_rows_when_tmux_listing_is_uncertain(
    agent_run_id, monkeypatch
):
    _make(agent_run_id)

    class FailedListing:
        returncode = 1
        stdout: list[str] = []
        stderr = ["operation temporarily unavailable"]

    class UncertainServer:
        def cmd(self, *args):
            assert args[:2] == (
                "list-sessions",
                "-F",
            )
            return FailedListing()

    with monkeypatch.context() as patch:
        patch.setattr(tmux, "_server", lambda: UncertainServer())
        with pytest.raises(TmuxSessionError, match="list-sessions failed"):
            tmux.reconcile_sessions()

    assert (
        AgentTerminalSession.objects.get(agent_run_id=agent_run_id).terminated_at
        is None
    )


def test_reconcile_preserves_rows_when_tmux_server_is_absent(agent_run_id):
    _make(agent_run_id)
    server = _server()
    stopped = server.cmd("kill-server")
    assert stopped.returncode == 0

    result = tmux.reconcile_sessions()

    assert result.inventory_available is False
    assert result.soft_deleted == []
    assert result.exited == []
    assert (
        AgentTerminalSession.objects.get(agent_run_id=agent_run_id).terminated_at
        is None
    )


def test_scroll_hides_position_marker_and_returns_to_live_prompt(agent_run_id):
    """Wheel bridge drives copy-mode scrollback without mouse mode (#578)."""

    _make(
        agent_run_id,
        command=(
            "i=1; while [ $i -le 80 ]; do "
            "printf 'SCROLL_%03d\\n' \"$i\"; i=$((i+1)); "
            "done; sleep 60"
        ),
    )
    server = _server()
    name = f"pt-{agent_run_id}"

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        history = server.cmd("display-message", "-t", name, "-p", "#{history_size}")
        if int((history.stdout or ["0"])[0].strip()) >= 40:
            break
        time.sleep(0.02)
    else:
        pytest.fail("tmux did not populate scrollback")

    marker = b"POSMARK"
    marker_option = server.cmd(
        "set-option",
        "-w",
        "-t",
        name,
        "copy-mode-position-format",
        marker.decode(),
    )
    assert marker_option.returncode == 0
    viewer_env = os.environ.copy()
    viewer_env["LC_ALL"] = "C.UTF-8"
    viewer_env["TERM"] = "xterm-256color"
    viewer_env.pop("TERMINFO", None)
    viewer = ptyprocess.PtyProcessUnicode.spawn(
        attach_argv(agent_run_id),
        env=viewer_env,
        dimensions=(12, 80),
    )
    try:
        # Discard the live screen so this read contains only copy-mode output.
        initial = _read_available_pty_bytes(viewer, timeout=1)
        assert initial, (
            f"tmux viewer produced no initial screen "
            f"(alive={viewer.isalive()}, exit={viewer.exitstatus})"
        )
        scroll(agent_run_id, "up", 5)
        rendered = _read_available_pty_bytes(viewer, timeout=1)

        after = server.cmd("display-message", "-t", name, "-p", "#{pane_in_mode}")
        assert (after.stdout or ["0"])[0].strip() == "1"
        position = server.cmd("display-message", "-t", name, "-p", "#{scroll_position}")
        assert int((position.stdout or ["0"])[0].strip()) >= 5
        assert viewer.isalive(), (
            f"tmux viewer exited during scroll (exit={viewer.exitstatus})"
        )
        assert b"SCROLL_" in rendered
        assert marker not in rendered

        # A large downward scroll returns to the prompt because -e exits at bottom.
        scroll(agent_run_id, "down", 500)
        after_down = server.cmd("display-message", "-t", name, "-p", "#{pane_in_mode}")
        assert (after_down.stdout or ["1"])[0].strip() == "0"

        mouse = server.cmd("show-options", "-gv", "mouse")
        assert (mouse.stdout or ["off"])[0].strip() == "off"
        assert tmux.get_session(agent_run_id) is not None
        assert AgentTerminalSession.objects.filter(
            agent_run_id=agent_run_id, terminated_at__isnull=True
        ).exists()

        with pytest.raises(TmuxSessionError):
            scroll(agent_run_id, "sideways", 3)
    finally:
        viewer.terminate(force=True)

    assert tmux.get_session(agent_run_id) is not None


def test_terminate_returns_true_then_false(agent_run_id):
    _make(agent_run_id)

    assert tmux.terminate_session(agent_run_id) is True
    assert tmux.terminate_session(agent_run_id) is False


def test_terminate_soft_deletes_metadata(agent_run_id):
    _make(agent_run_id)

    assert tmux.terminate_session(agent_run_id) is True

    row = AgentTerminalSession.objects.get(agent_run_id=agent_run_id)

    assert row.terminated_at is not None


def test_list_sessions_ignores_non_pt_sessions(agent_run_id):
    _make(agent_run_id)

    # Drop a session whose name does not start with ``pt-`` directly
    # on the same socket and confirm it is filtered out.

    foreign = f"foreign-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        [
            "tmux",
            "-L",
            TMUX_SOCKET,
            "new-session",
            "-d",
            "-s",
            foreign,
            "sleep 60",
        ],
        check=True,
    )
    try:
        names = {s.name for s in tmux.list_sessions()}
        assert f"pt-{agent_run_id}" in names
        assert foreign not in names
        assert all(n.startswith(SESSION_PREFIX) for n in names)
    finally:
        subprocess.run(
            ["tmux", "-L", TMUX_SOCKET, "kill-session", "-t", foreign],
            check=False,
        )


def test_create_session_does_not_start_provider_when_db_insert_fails(
    agent_run_id, monkeypatch, tmp_path
):
    """A failed metadata insert rolls back before any provider work starts."""

    def boom(**kwargs):
        raise RuntimeError("db down")

    launched = tmp_path / "provider-started"
    monkeypatch.setattr(AgentTerminalSession.objects, "create", boom)

    with pytest.raises(TmuxSessionError, match="persist session metadata failed"):
        _make(agent_run_id, command=f"touch {launched}; sleep 60")

    assert not launched.exists()
    assert tmux.get_session(agent_run_id) is None


def test_attach_argv_shape():
    argv = attach_argv("abc123")

    assert argv == ["tmux", "-L", "muxed", "attach", "-t", "pt-abc123"]


def test_attach_argv_uses_profile_scoped_tmux_socket(monkeypatch):
    monkeypatch.setenv("MUXED_TMUX_SOCKET", "muxed-dev-0123456789abcdef")

    assert attach_argv("abc123") == [
        "tmux",
        "-L",
        "muxed-dev-0123456789abcdef",
        "attach",
        "-t",
        "pt-abc123",
    ]


def test_attach_argv_uses_the_rust_approved_tmux_path(monkeypatch):
    monkeypatch.setenv("MUXED_APPROVED_TMUX_PATH", "/opt/muxed/bin/tmux")

    assert attach_argv("abc123") == [
        "/opt/muxed/bin/tmux",
        "-L",
        "muxed",
        "attach",
        "-t",
        "pt-abc123",
    ]


def test_refresh_client_size_issues_expected_tmux_command(monkeypatch):
    calls: list[tuple[str, ...]] = []

    class Result:
        returncode = 0
        stderr: list[str] = []

    class Server:
        def cmd(self, *args):
            calls.append(args)
            return Result()

    monkeypatch.setattr("apps.terminals.tmux.client._server", lambda: Server())

    refresh_client_size("abc", 120, 40)

    assert calls == [("refresh-client", "-t", "pt-abc", "-C", "120x40")]


def test_refresh_client_size_raises_on_tmux_error(monkeypatch):
    class Result:
        returncode = 1
        stderr = ["no current client"]

    class Server:
        def cmd(self, *args):
            return Result()

    monkeypatch.setattr("apps.terminals.tmux.client._server", lambda: Server())

    with pytest.raises(TmuxSessionError, match="refresh-client failed"):
        refresh_client_size("abc", 120, 40)


def test_get_session_returns_none_when_missing():
    assert tmux.get_session(f"missing-{uuid.uuid4().hex}") is None
