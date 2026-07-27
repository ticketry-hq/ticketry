"""Integration tests for ``terminals/tmux.py``.

Each test creates and tears down its own tmux session on the dedicated
``Muxed`` socket and is skipped (not failed) if ``tmux`` is missing
from ``PATH``. Metadata persistence is checked against the Django ORM.
"""

from __future__ import annotations

import shutil
import subprocess
import uuid

import pytest

from apps.runs.models import AgentRun
from apps.terminals.tmux import sessions as tmux
from apps.terminals.tmux._core import SESSION_PREFIX, TMUX_SOCKET, TmuxSessionError, _server
from apps.terminals.tmux.client import attach_argv, refresh_client_size, scroll
from apps.terminals.tmux.metadata import TmuxSession, _parse_show_options
from apps.terminals.models import AgentTerminalSession


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(
        shutil.which("tmux") is None, reason="tmux binary not on PATH"
    ),
]


def _run_id() -> str:
    # Unique id per test isolates concurrent test sessions on the socket.

    return f"test-{uuid.uuid4().hex[:12]}"


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


def _make(rid: str) -> TmuxSession:
    return tmux.create_session(
        agent_run_id=rid,
        task_id="task-123",
        module_id="module-456",
        project_id="project-789",
        agent="claude-code",
        command="sleep 60",
        cwd="/tmp",
    )


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


def test_scroll_enters_copy_mode_and_rejects_bad_direction(agent_run_id):
    """Wheel bridge drives copy-mode scrollback without mouse mode (#578)."""

    _make(agent_run_id)
    server = _server()
    name = f"pt-{agent_run_id}"

    # Not in copy-mode before the first scroll.
    before = server.cmd("display-message", "-t", name, "-p", "#{pane_in_mode}")
    assert (before.stdout or ["0"])[0].strip() == "0"

    scroll(agent_run_id, "up", 5)

    after = server.cmd("display-message", "-t", name, "-p", "#{pane_in_mode}")
    assert (after.stdout or ["0"])[0].strip() == "1"

    # Scrolling down is accepted (returns to prompt; -e exits at the bottom).
    scroll(agent_run_id, "down", 5)

    with pytest.raises(TmuxSessionError):
        scroll(agent_run_id, "sideways", 3)


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


def test_create_session_kills_tmux_when_db_insert_fails(agent_run_id, monkeypatch):
    """A failed metadata insert must kill the just-created tmux session."""

    def boom(**kwargs):
        raise RuntimeError("db down")

    # Force the persistence step to fail after the session is created.

    monkeypatch.setattr(AgentTerminalSession.objects, "create", boom)

    with pytest.raises(TmuxSessionError, match="persist session metadata failed"):
        _make(agent_run_id)

    # The orphaned tmux session was reaped; nothing remains to attach to.

    assert tmux.get_session(agent_run_id) is None


def test_attach_argv_shape():
    argv = attach_argv("abc123")

    assert argv == ["tmux", "-L", "muxed", "attach", "-t", "pt-abc123"]


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
