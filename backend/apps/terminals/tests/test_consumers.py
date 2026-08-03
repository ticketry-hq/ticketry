"""Tests for the PTY terminal WebSocket consumer (ticket #535).

Ported from the FastAPI ``web/backend/tests/test_terminal.py`` WebSocket
suite to ``channels.testing.WebsocketCommunicator``. ptyprocess runs tiny
deterministic commands (printf/sleep); tmux is faked throughout.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from datetime import datetime, timezone

import pytest
from channels.testing.websocket import WebsocketCommunicator

from studio_server.asgi import application
from apps.runs.models import AgentRun
from apps.terminals.dao import SCRATCH_TASK_ID
from worktracker.tests.factories import fixture_issue_id, fixture_uuid

from apps.terminals.tests.conftest import write_profiles


pytestmark = pytest.mark.django_db(transaction=True)

PROJECT_ID = fixture_uuid("p1")
MODULE_ID = fixture_issue_id(project_id="p1", module_id="m1", task_id=None)
TASK_ID = fixture_issue_id(project_id="p1", module_id="m1", task_id="t1")


# ---------- helpers ----------


def _init_frame(**overrides):
    base = {
        "type": "init",
        "mode": "spawn",
        "agent": "claude",
        "project_id": PROJECT_ID,
        "module_id": MODULE_ID,
        "task_id": TASK_ID,
        "initial_prompt": None,
        "cols": 80,
        "rows": 24,
        "is_planning": False,
        "is_instant": False,
        "instant_prompt": None,
        "is_doc_chat": False,
        "doc_rel_path": None,
        "doc_id": None,
    }
    base.update(overrides)
    return base


def _attach_init(agent_run_id="run-abc", cols=80, rows=24):
    return {
        "type": "init",
        "mode": "attach",
        "agent_run_id": agent_run_id,
        "cols": cols,
        "rows": rows,
    }


def _stub_task_details(task_id: str = TASK_ID):
    """Build a TaskDetails object compatible with build_context_prompt."""
    from studio_server.contracts import TaskDetails, TaskState, TaskSummary

    task = TaskSummary(
        id=task_id,
        name="Stub task",
        issue_type="Story",
        sequence_id=42,
        state=TaskState(id="s1", name="Todo", group="unstarted"),
        description="A stub.",
        project_id=PROJECT_ID,
        parent_id=None,
        module_ids=[MODULE_ID],
        child_count=0,
    )
    return TaskDetails(task=task)


def _fake_tmux_session(agent_run_id="run-abc"):
    from apps.terminals.tmux.metadata import TmuxSession

    return TmuxSession(
        name=f"pt-{agent_run_id}",
        agent_run_id=agent_run_id,
        task_id="task-1",
        module_id="mod-1",
        project_id="proj-1",
        agent="claude-code",
        created_at=datetime.now(timezone.utc),
        scope="task",
    )


async def _communicator():
    """Open a terminal socket and assert it is accepted."""

    communicator = WebsocketCommunicator(application, "/ws/terminal")
    connected, _ = await communicator.connect()
    assert connected
    return communicator


async def _drain_until_close(communicator, limit: int = 50) -> bytes:
    """Collect binary frames until the socket closes."""

    collected = b""
    for _ in range(limit):
        try:
            out = await communicator.receive_output(timeout=2)
        except Exception:
            break
        if out["type"] == "websocket.close":
            break
        if out.get("bytes") is not None:
            collected += out["bytes"]
    return collected


async def _wait_until(predicate, attempts: int = 40) -> None:
    """Poll a predicate, yielding the loop between checks."""

    for _ in range(attempts):
        if predicate():
            return
        await asyncio.sleep(0.05)


def _patch_agent_argv(monkeypatch):
    """Override the "claude" adapter so tests spawn a deterministic process.

    Every spawn frame here uses agent="claude", so binding a FakeAdapter over
    that slug in ``registry._REGISTRY`` routes both the argv and the (no-op)
    injection through the fake. Fakes must *replace* an existing slug, never
    add one: ``VALID_AGENTS`` is an import-time snapshot and the WS path
    validates the slug before spawn.
    """
    import apps.terminals.agents.registry as registry
    from apps.terminals.tests.fakes import FakeAdapter

    def factory(argv_factory):
        fake = FakeAdapter(
            slug="claude", command_fn=lambda prompt: argv_factory("claude", prompt)
        )
        monkeypatch.setitem(registry._REGISTRY, "claude", fake)

    return factory


def _patch_repo(monkeypatch):
    """Stub the owned WorkTracker detail query."""
    from apps import worktracker_queries

    async def fake_get_task_details(project_id, task_id):
        return _stub_task_details(task_id)

    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)


@pytest.fixture(autouse=True)
def clean_terminal_state():
    import apps.terminals.consumers as consumers

    consumers.SESSIONS.clear()
    consumers.TMUX_VIEWERS.clear()
    yield
    for session in list(consumers.SESSIONS.values()):
        session.terminate(force=True)
    consumers.SESSIONS.clear()
    consumers.TMUX_VIEWERS.clear()


# ---------- init validation / errors ----------


async def test_init_roundtrip_and_clean_exit(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["printf", "ready"])

    monkeypatch.setattr(
        consumers.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ready"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    assert isinstance(ready["session_id"], str) and ready["session_id"]

    collected = await _drain_until_close(communicator)
    assert b"ready" in collected

    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_unknown_agent(configured):
    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame(agent="bogus")))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "unknown_agent"}
    await communicator.disconnect()


async def test_promptless_task_launch_returns_the_resolver_code(
    configured, monkeypatch
):
    import apps.terminals.session as session_module

    def reject_promptless(task_id, *, agent_override=None):
        del task_id, agent_override
        raise ValueError("prompt_not_configured")

    monkeypatch.setattr(
        session_module, "resolve_task_launch_configuration", reject_promptless
    )
    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))

    msg = json.loads(await communicator.receive_from(timeout=2))

    assert msg == {"type": "error", "message": "prompt_not_configured"}
    await communicator.disconnect()


async def test_bad_init_non_json(configured):
    communicator = await _communicator()
    await communicator.send_to(text_data="not json")
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_bad_init_binary_first_frame(configured):
    communicator = await _communicator()
    await communicator.send_to(bytes_data=b"\x00\x01")
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_init_missing_mode_rejected(configured):
    # The CODIN-685 bug class: an init frame with no `mode` is now rejected
    # outright rather than inferred from agent_run_id presence (#692).
    frame = _init_frame()
    del frame["mode"]
    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(frame))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_init_unknown_mode_rejected(configured):
    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame(mode="bogus")))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_attach_without_agent_run_id_rejected(configured):
    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps({"type": "init", "mode": "attach", "cols": 80, "rows": 24})
    )
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_spawn_carrying_agent_run_id_rejected(configured):
    # A spawn frame that smuggles an agent_run_id is a mislabeled attach; reject
    # it rather than silently taking the wrong branch (#692).
    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(_init_frame(agent_run_id="run-xyz"))
    )
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_no_profile(tmp_config):
    # tmp_config writes nothing → no profiles configured.
    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg["type"] == "error"
    assert msg["message"] == "no_profile_selected"
    await communicator.disconnect()


async def test_instant_mode_empty_prompt_rejected(configured):
    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(
            _init_frame(task_id=None, is_instant=True, instant_prompt="   ")
        )
    )
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_instant_and_planning_mutually_exclusive(configured):
    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(
            _init_frame(task_id=None, is_planning=True, is_instant=True, instant_prompt="x")
        )
    )
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "bad_init"}
    await communicator.disconnect()


async def test_max_sessions_guard(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["sleep", "30"])
    monkeypatch.setattr(consumers, "MAX_SESSIONS", 1)
    monkeypatch.setattr(
        consumers.tmux, "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await first.receive_from(timeout=2))
    assert ready["type"] == "ready"

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_init_frame()))
    msg = json.loads(await second.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "too_many_sessions"}

    assert len(consumers.SESSIONS) == 1
    await second.disconnect()
    await first.disconnect()


# ---------- spawn behavior ----------


async def test_dimensions_ordering(configured, monkeypatch):
    """Viewer spawn receives xterm geometry and a Finder-safe environment."""
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["printf", "x"])
    monkeypatch.setenv("TERM", "dumb")
    monkeypatch.setenv("LC_ALL", "C")
    monkeypatch.delenv("LC_CTYPE", raising=False)
    monkeypatch.setenv("TERMINFO", "/tmp/inherited-terminfo")
    monkeypatch.setenv("TERMINFO_DIRS", "/tmp/inherited-terminfo-dirs")

    monkeypatch.setattr(
        consumers.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "x"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    captured: dict = {}
    real_spawn = consumers.ptyprocess.PtyProcessUnicode.spawn

    def spy_spawn(argv, **kwargs):
        captured["dimensions"] = kwargs.get("dimensions")
        captured["environment"] = kwargs.get("env")
        return real_spawn(argv, **kwargs)

    monkeypatch.setattr(consumers.ptyprocess.PtyProcessUnicode, "spawn", spy_spawn)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame(cols=80, rows=24)))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    await _drain_until_close(communicator)

    assert captured["dimensions"] == (24, 80)
    assert captured["environment"]["TERM"] == "xterm-256color"
    assert captured["environment"]["LC_CTYPE"] == consumers._VIEWER_LC_CTYPE
    assert "LC_ALL" not in captured["environment"]
    assert "TERMINFO" not in captured["environment"]
    assert "TERMINFO_DIRS" not in captured["environment"]
    await communicator.disconnect()


async def test_resize_calls_setwinsize(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["sleep", "5"])

    monkeypatch.setattr(
        consumers.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "5"])

    captured: list[tuple[int, int]] = []
    original = consumers.PtySession.setwinsize

    def spy(self, rows, cols):
        captured.append((rows, cols))
        return original(self, rows, cols)

    monkeypatch.setattr(consumers.PtySession, "setwinsize", spy)

    # window-size manual means tmux only follows refresh-client -C; the resize
    # frame must drive it or the window never grows (the dotted dead band).
    refreshed: list[tuple[int, int]] = []
    monkeypatch.setattr(
        consumers.tmux,
        "refresh_client_size",
        lambda rid, cols, rows: refreshed.append((cols, rows)),
    )

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"

    await communicator.send_to(text_data=json.dumps({"type": "resize", "cols": 120, "rows": 40}))
    await _wait_until(lambda: (40, 120) in captured)

    assert (40, 120) in captured
    await _wait_until(lambda: (120, 40) in refreshed)
    assert (120, 40) in refreshed
    await communicator.disconnect()


async def test_client_disconnect_terminates_pty(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["sleep", "30"])

    monkeypatch.setattr(
        consumers.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    terminate_calls: list[bool] = []
    original_terminate = consumers.PtySession.terminate

    def spy_terminate(self, force=True):
        terminate_calls.append(force)
        return original_terminate(self, force=force)

    monkeypatch.setattr(consumers.PtySession, "terminate", spy_terminate)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"

    await communicator.disconnect()

    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    assert any(force is True for force in terminate_calls)


async def test_instant_mode_builds_prompt_and_launches(configured, monkeypatch):
    """is_instant=true + non-empty instant_prompt + no task_id → uses build_instant_change_prompt."""
    from studio_server.contracts import ModuleSummary
    from apps import worktracker_queries
    import apps.terminals.consumers as consumers

    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Mod One", project_id=project_id)]

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)

    captured: dict = {}

    def fake_build(
        *,
        module,
        workspace_slug,
        project_id,
        folder,
        user_input,
        design_dir=None,
        allow_self_termination,
    ):
        captured["module_id"] = module.id
        captured["workspace_slug"] = workspace_slug
        captured["project_id"] = project_id
        captured["folder"] = folder
        captured["user_input"] = user_input
        return "INSTANT_PROMPT_OK"

    monkeypatch.setattr("apps.terminals.prompt_builder.build_instant_change_prompt", fake_build)

    captured_argv: dict = {}

    def argv(agent, prompt):
        captured_argv["agent"] = agent
        captured_argv["prompt"] = prompt
        return ["printf", "ok"]

    _patch_agent_argv(monkeypatch)(argv)
    monkeypatch.setattr(
        consumers.tmux, "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ok"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(
            _init_frame(task_id=None, is_instant=True, instant_prompt="rename foo to bar")
        )
    )
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    await _drain_until_close(communicator)

    assert captured["module_id"] == MODULE_ID
    assert captured["project_id"] == PROJECT_ID
    assert captured["user_input"] == "rename foo to bar"
    assert captured_argv["prompt"] == "INSTANT_PROMPT_OK"
    await communicator.disconnect()


# ---------- persisted spawn / fallback ----------


async def test_task_spawn_creates_persisted_tmux_session(configured, monkeypatch):
    """A task-bound spawn records an agent_run + tmux session and attaches."""
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])

    created: dict = {}

    def fake_create_session(**kwargs):
        created.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(consumers.tmux, "create_session", fake_create_session)
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ok"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    run_id = ready["agent_run_id"]
    assert isinstance(run_id, str) and run_id
    await _drain_until_close(communicator)

    assert created["task_id"] == TASK_ID
    assert created["agent_run_id"] == run_id
    assert "claude" in created["command"]

    runs = [r.id async for r in AgentRun.objects.filter(issue_id=TASK_ID)]
    assert runs == [run_id]
    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_scroll_frame_drives_tmux_copy_mode(configured, monkeypatch):
    """A scroll frame bridges to tmux.scroll for a tmux-backed session (#578)."""
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])
    monkeypatch.setattr(
        consumers.tmux,
        "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    # Long-lived attach so the pump is alive when the scroll frame arrives.
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "5"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    scrolls: list[tuple[str, str, int]] = []
    monkeypatch.setattr(
        consumers.tmux,
        "scroll",
        lambda rid, direction, lines: scrolls.append((rid, direction, lines)),
    )

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    run_id = ready["agent_run_id"]

    await communicator.send_to(
        text_data=json.dumps({"type": "scroll", "dir": "up", "lines": 5})
    )
    await _wait_until(lambda: (run_id, "up", 5) in scrolls)
    assert (run_id, "up", 5) in scrolls

    # A bad direction is ignored, not forwarded.
    await communicator.send_to(
        text_data=json.dumps({"type": "scroll", "dir": "left", "lines": 5})
    )
    await communicator.send_to(
        text_data=json.dumps({"type": "scroll", "dir": "down", "lines": 2})
    )
    await _wait_until(lambda: (run_id, "down", 2) in scrolls)
    assert all(d in ("up", "down") for _, d, _ in scrolls)

    await communicator.disconnect()


async def test_task_spawn_errors_when_tmux_unavailable(configured, monkeypatch):
    """If tmux create fails, the hard tmux requirement surfaces an error."""
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["printf", "ready"])

    def boom(**kwargs):
        raise consumers.tmux.TmuxSessionError("no tmux server")

    monkeypatch.setattr(consumers.tmux, "create_session", boom)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "spawn_failed: no tmux server"}

    runs = [r.id async for r in AgentRun.objects.filter(issue_id=TASK_ID)]
    assert runs == []
    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_instant_spawn_persists_under_scratch_sentinel(configured, monkeypatch):
    """An instant (no-task) spawn persists durably under the scratch sentinel."""
    from studio_server.contracts import ModuleSummary
    from apps import worktracker_queries
    import apps.terminals.consumers as consumers

    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Mod One", project_id=project_id)]

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr("apps.terminals.prompt_builder.build_instant_change_prompt", lambda **kw: "INSTANT_OK")
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])

    created: dict = {}

    def fake_create_session(**kwargs):
        created.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(consumers.tmux, "create_session", fake_create_session)
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ok"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(_init_frame(task_id=None, is_instant=True, instant_prompt="do it"))
    )
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    run_id = ready["agent_run_id"]
    assert isinstance(run_id, str) and run_id
    await _drain_until_close(communicator)

    assert created["task_id"] == SCRATCH_TASK_ID
    assert created["scope"] == "instant"
    runs = [r.id async for r in AgentRun.objects.filter(issue_id=MODULE_ID)]
    assert runs == [run_id]
    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_initial_persisted_spawn_reserves_and_releases_agent_run(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])

    monkeypatch.setattr(
        consumers.tmux, "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    run_id = ready["agent_run_id"]
    assert consumers.TMUX_VIEWERS == {run_id: ready["session_id"]}

    await communicator.disconnect()
    await _wait_until(lambda: run_id not in consumers.TMUX_VIEWERS)
    assert run_id not in consumers.TMUX_VIEWERS


async def test_initial_persisted_spawn_resize_failure_releases_reservation(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])

    monkeypatch.setattr(
        consumers.tmux, "create_session",
        lambda **kwargs: _fake_tmux_session(kwargs["agent_run_id"]),
    )
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])

    def fail_refresh(rid, cols, rows):
        raise consumers.tmux.TmuxSessionError("bad geometry")

    monkeypatch.setattr(consumers.tmux, "refresh_client_size", fail_refresh)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_init_frame()))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "attach_resize_failed: bad geometry"}

    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    assert consumers.TMUX_VIEWERS == {}
    await communicator.disconnect()


# ---------- attach ----------


async def test_attach_uses_attach_argv_and_spawns(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    captured: dict = {}

    def fake_attach_argv(rid):
        captured["rid"] = rid
        return ["printf", "ok"]

    monkeypatch.setattr(consumers.tmux, "attach_argv", fake_attach_argv)
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-xyz")))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    assert isinstance(ready["session_id"], str) and ready["session_id"]

    collected = await _drain_until_close(communicator)

    assert captured["rid"] == "run-xyz"
    assert b"ok" in collected
    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_attach_session_not_found(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: None)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id="missing")))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "session_not_found"}

    assert consumers.SESSIONS == {}
    await communicator.disconnect()


async def test_attach_respects_max_sessions(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers, "MAX_SESSIONS", 1)
    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_attach_init(agent_run_id="r1")))
    ready = json.loads(await first.receive_from(timeout=2))
    assert ready["type"] == "ready"

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_attach_init(agent_run_id="r2")))
    msg = json.loads(await second.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "too_many_sessions"}

    await second.disconnect()
    await first.disconnect()


async def test_attach_resize_calls_setwinsize(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "5"])

    refreshed: list[tuple[int, int]] = []
    monkeypatch.setattr(
        consumers.tmux,
        "refresh_client_size",
        lambda rid, cols, rows: refreshed.append((cols, rows)),
    )

    captured: list[tuple[int, int]] = []
    original = consumers.PtySession.setwinsize

    def spy(self, rows, cols):
        captured.append((rows, cols))
        return original(self, rows, cols)

    monkeypatch.setattr(consumers.PtySession, "setwinsize", spy)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init()))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"

    await communicator.send_to(text_data=json.dumps({"type": "resize", "cols": 120, "rows": 40}))
    await _wait_until(lambda: (40, 120) in captured)

    assert (40, 120) in captured
    # The resize frame must also drive the tmux window (window-size manual).
    await _wait_until(lambda: (120, 40) in refreshed)
    assert (120, 40) in refreshed
    await communicator.disconnect()


async def test_attach_close_does_not_terminate_tmux_session(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    terminate_calls: list[str] = []

    def fake_terminate_session(rid):
        terminate_calls.append(rid)
        return True

    monkeypatch.setattr(consumers.tmux, "terminate_session", fake_terminate_session)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id="r-keep")))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"

    await communicator.disconnect()
    await _wait_until(lambda: not consumers.SESSIONS)

    assert consumers.SESSIONS == {}
    assert terminate_calls == []


async def test_attach_calls_refresh_client_size_with_init_geometry(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    captured: list[tuple[str, int, int]] = []

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ok"])
    monkeypatch.setattr(
        consumers.tmux, "refresh_client_size",
        lambda rid, cols, rows: captured.append((rid, cols, rows)),
    )

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-size", cols=132, rows=43)))
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    await _drain_until_close(communicator)

    assert captured == [("run-size", 132, 43)]
    await communicator.disconnect()


async def test_attach_resize_failure_releases_reservation(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])

    def fail_refresh(rid, cols, rows):
        raise consumers.tmux.TmuxSessionError("bad geometry")

    monkeypatch.setattr(consumers.tmux, "refresh_client_size", fail_refresh)

    communicator = await _communicator()
    await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-bad-size")))
    msg = json.loads(await communicator.receive_from(timeout=2))
    assert msg == {"type": "error", "message": "attach_resize_failed: bad geometry"}

    await _wait_until(lambda: not consumers.SESSIONS)
    assert consumers.SESSIONS == {}
    assert consumers.TMUX_VIEWERS == {}
    await communicator.disconnect()


async def test_second_attach_same_agent_run_replaces_existing_viewer(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_attach_init(agent_run_id="same-run")))
    ready = json.loads(await first.receive_from(timeout=2))
    assert ready["type"] == "ready"

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_attach_init(agent_run_id="same-run")))
    replacement = json.loads(await second.receive_from(timeout=2))
    assert replacement["type"] == "ready"

    await _drain_until_close(first)
    assert consumers.TMUX_VIEWERS == {"same-run": replacement["session_id"]}
    assert ready["session_id"] not in consumers.SESSIONS

    await first.disconnect()
    await second.disconnect()


async def test_failed_replacement_keeps_existing_viewer(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    resize_calls = 0

    def fail_second_resize(rid, cols, rows):
        nonlocal resize_calls
        resize_calls += 1
        if resize_calls == 2:
            raise consumers.tmux.TmuxSessionError("bad replacement geometry")

    monkeypatch.setattr(consumers.tmux, "refresh_client_size", fail_second_resize)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_attach_init(agent_run_id="same-run")))
    ready = json.loads(await first.receive_from(timeout=2))
    assert ready["type"] == "ready"

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_attach_init(agent_run_id="same-run")))
    error = json.loads(await second.receive_from(timeout=2))
    assert error == {
        "type": "error",
        "message": "attach_resize_failed: bad replacement geometry",
    }
    assert consumers.TMUX_VIEWERS == {"same-run": ready["session_id"]}
    assert ready["session_id"] in consumers.SESSIONS

    await second.disconnect()
    await first.disconnect()


async def test_concurrent_attach_different_agent_run_succeeds(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-a")))
    assert json.loads(await first.receive_from(timeout=2))["type"] == "ready"

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-b")))
    assert json.loads(await second.receive_from(timeout=2))["type"] == "ready"
    assert set(consumers.TMUX_VIEWERS) == {"run-a", "run-b"}

    await second.disconnect()
    await first.disconnect()


async def test_attach_reservation_released_after_close(configured, monkeypatch):
    import apps.terminals.consumers as consumers

    monkeypatch.setattr(consumers.tmux, "get_session", lambda rid: _fake_tmux_session(rid))
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["sleep", "30"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    first = await _communicator()
    await first.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-reopen")))
    assert json.loads(await first.receive_from(timeout=2))["type"] == "ready"

    await first.disconnect()
    await _wait_until(lambda: "run-reopen" not in consumers.TMUX_VIEWERS)
    assert "run-reopen" not in consumers.TMUX_VIEWERS

    second = await _communicator()
    await second.send_to(text_data=json.dumps(_attach_init(agent_run_id="run-reopen")))
    assert json.loads(await second.receive_from(timeout=2))["type"] == "ready"
    await second.disconnect()


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux binary not on PATH")
async def test_attach_live_tmux_session_survives_ws_close(configured):
    from asgiref.sync import sync_to_async
    from apps.terminals.tmux import sessions as tmux
    from apps.terminals.tmux._core import TmuxSessionError

    rid = f"test-attach-{uuid.uuid4().hex[:8]}"
    try:
        await sync_to_async(AgentRun.objects.create)(
            id=rid,
            issue_id=TASK_ID,
            agent="claude-code",
            status="running",
            started_at="2026-05-29T10:00:00",
            cwd="/tmp",
            scope="task",
        )
        await sync_to_async(tmux.create_session)(
            agent_run_id=rid,
            task_id="task-x",
            module_id="mod-x",
            project_id="proj-x",
            agent="claude-code",
            command="while true; do printf live-attach; sleep 1; done",
            cwd="/tmp",
        )

        communicator = await _communicator()
        await communicator.send_to(text_data=json.dumps(_attach_init(agent_run_id=rid)))
        ready = json.loads(await communicator.receive_from(timeout=2))
        assert ready["type"] == "ready"
        await communicator.send_to(bytes_data=b" ")
        await communicator.disconnect()

        # WS closed; tmux session must still be alive.
        assert await sync_to_async(tmux.get_session)(rid) is not None
    finally:
        try:
            await sync_to_async(tmux.terminate_session)(rid)
        except TmuxSessionError:
            pass


# ---------- design-directory prompt injection (#521) ----------


def _patch_worktracker_for_design(monkeypatch):
    """Stub worktracker lookups _build_prompt makes for design-dir resolution."""
    from apps import worktracker_queries
    from studio_server.contracts import ModuleSummary

    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Platform", project_id=PROJECT_ID)]

    async def fake_get_task_details(project_id, task_id):
        return _stub_task_details(task_id)

    async def fake_get_tasks_and_states(project_id, module_id):
        return [], []

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)
    monkeypatch.setattr(worktracker_queries, "get_tasks_and_states", fake_get_tasks_and_states)


async def _build(module_folder, **overrides):
    """Call consumers._build_prompt with task-mode defaults."""
    import apps.terminals.consumers as consumers

    kwargs = dict(
        is_planning=False,
        is_instant=False,
        instant_prompt=None,
        project_id=PROJECT_ID,
        module_id=MODULE_ID,
        task_id=TASK_ID,
        initial_prompt=None,
        agent_run_id="a3f9c2d1deadbeef",
        module_folder=module_folder,
        agent="claude",
    )
    kwargs.update(overrides)
    return await consumers._build_prompt(0, **kwargs)


async def test_task_prompt_injects_created_design_dir(tmp_config, sample_profile, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, design_dir, cwd, err = await _build(str(module_folder))

    assert err is None
    assert cwd is None
    rel = f"spec/platform--{MODULE_ID[:8]}/T42--stub-task"
    assert f"Design directory: {rel}" in prompt
    assert design_dir == str((module_folder / rel).resolve())
    assert (module_folder / rel).is_dir()


async def test_concurrent_task_prompt_builds_share_one_design_dir(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    """Two spawns for the same task may build prompts concurrently.

    ``_build_prompt`` used to hold a process-wide lock around its whole body,
    so this could not race. Design-dir creation is idempotent —
    ``resolve_task_design_dir`` is a pure read plus a deterministic name and
    ``ensure_dir`` is ``mkdir(parents=True, exist_ok=True)`` — so both builds
    must land on the same intact directory without it.
    """

    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    first, second = await asyncio.gather(
        _build(str(module_folder)),
        _build(str(module_folder)),
    )

    rel = f"spec/platform--{MODULE_ID[:8]}/T42--stub-task"
    for prompt, design_dir, _cwd, err in (first, second):
        assert err is None
        assert f"Design directory: {rel}" in prompt
        assert design_dir == str((module_folder / rel).resolve())
    assert (module_folder / rel).is_dir()


async def test_task_prompt_ignores_legacy_profile_prompt_map(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    """Task launches use the profile reloaded at spawn, not import-time config."""
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    profile["agent_prompts"] = {"Todo": "SAVED PROMPT OVERRIDE"}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, _design_dir, _cwd, err = await _build(str(module_folder))

    assert err is None
    assert "SAVED PROMPT OVERRIDE" not in prompt


async def test_planning_prompt_uses_run_scoped_dir_and_move_contract(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, design_dir, cwd, err = await _build(str(module_folder), is_planning=True, task_id=None)

    assert err is None
    rel = f"spec/platform--{MODULE_ID[:8]}/planning/a3f9c2d1"
    assert f"Design directory: {rel}" in prompt
    assert "move" in prompt and "canonical design" in prompt
    assert (module_folder / rel).is_dir()
    assert design_dir == str((module_folder / rel).resolve())


async def test_instant_prompt_gets_design_dir(tmp_config, sample_profile, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, design_dir, cwd, err = await _build(
        str(module_folder), is_instant=True, instant_prompt="fix typo", task_id=None
    )

    assert err is None
    assert f"Design directory: spec/platform--{MODULE_ID[:8]}/planning/a3f9c2d1" in prompt
    assert design_dir is not None


async def test_mcp_enabled_instant_prompt_requires_opt_in_before_self_termination(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, _design_dir, _cwd, err = await _build(
        str(module_folder),
        is_instant=True,
        instant_prompt="fix typo",
        task_id=None,
        agent="codex",
    )

    assert err is None
    rendered = " ".join(prompt.split())
    assert rendered.count("May I terminate this run") == 1
    assert rendered.index("May I terminate this run") < rendered.index("Make the change")
    assert "Only an explicit affirmative response" in rendered
    assert "Refusal, an ambiguous response, or no response" in rendered
    assert "Remember that decision for this run" in rendered
    assert "blocked, failed, ambiguous, or larger than expected" in rendered
    assert rendered.index("briefly report what changed") < rendered.index(
        "terminate_current_run"
    )
    assert "terminate_current_run with no arguments" in rendered
    assert "no WorkTracker task is being tracked" in rendered
    assert "Plan Feature" in rendered


async def test_gemini_instant_prompt_includes_self_termination_guidance(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, _design_dir, _cwd, err = await _build(
        str(module_folder),
        is_instant=True,
        instant_prompt="fix typo",
        task_id=None,
        agent="gemini",
    )

    assert err is None
    assert "May I terminate this run" in prompt
    assert "terminate_current_run" in prompt
    assert "no WorkTracker task is being tracked" in prompt
    assert "Plan Feature" in prompt


async def test_self_termination_guidance_is_instant_only(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    task_prompt, *_ = await _build(str(module_folder))
    planning_prompt, *_ = await _build(
        str(module_folder), is_planning=True, task_id=None
    )
    doc_prompt, *_ = await _build(
        str(module_folder),
        is_doc_chat=True,
        doc_rel_path="LLD.html",
        task_id=None,
    )

    for prompt in (task_prompt, planning_prompt, doc_prompt):
        assert "terminate_current_run" not in prompt
        assert "May I terminate this run" not in prompt


async def test_no_module_folder_degrades_without_contract_block(tmp_config, sample_profile, monkeypatch):
    write_profiles(tmp_config, [sample_profile], recent=0)
    _patch_worktracker_for_design(monkeypatch)

    prompt, design_dir, cwd, err = await _build(None)

    assert err is None
    assert cwd is None
    assert design_dir is None
    assert "Design directory:" not in prompt


# ---------- doc-agent overlay / doc-chat (#625) ----------


def test_validate_init_accepts_doc_chat():
    from apps.terminals import consumers

    init, err = consumers._validate_init(
        _init_frame(is_doc_chat=True, doc_rel_path="LLD.html", task_id=TASK_ID)
    )
    assert err is None
    assert init["mode"] == "spawn"
    assert init["is_doc_chat"] is True
    assert init["doc_rel_path"] == "LLD.html"


def test_validate_init_doc_chat_allows_no_task():
    from apps.terminals import consumers

    init, err = consumers._validate_init(
        _init_frame(is_doc_chat=True, doc_rel_path="LLD.html", task_id=None)
    )
    assert err is None
    assert init["task_id"] is None


def test_validate_init_rejects_unsafe_doc_path():
    from apps.terminals import consumers

    for bad in ["/etc/passwd", "../escape.html", "a/../../b.html", "", "   "]:
        _, err = consumers._validate_init(
            _init_frame(is_doc_chat=True, doc_rel_path=bad, task_id=TASK_ID)
        )
        assert err == "bad_init", bad


def test_validate_init_doc_chat_mutually_exclusive_with_planning():
    from apps.terminals import consumers

    _, err = consumers._validate_init(
        _init_frame(
            is_doc_chat=True, doc_rel_path="LLD.html", is_planning=True, task_id=TASK_ID
        )
    )
    assert err == "bad_init"


async def test_doc_chat_prompt_runs_in_doc_design_dir(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    """The doc-chat run's cwd is the registered doc's design dir (#625)."""
    module_folder = tmp_path / "repo"
    design_dir = module_folder / "spec/platform--m1/T42--stub-task"
    design_dir.mkdir(parents=True)
    (design_dir / "LLD.html").write_text("<html></html>")
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)

    from apps.documents import dao as ddao

    await ddao.upsert_document(
        doc_id="d1",
        module_id=MODULE_ID,
        task_id=TASK_ID,
        scope="task",
        root_dir=str(design_dir),
        rel_path="LLD.html",
        discovered_by_run_id=None,
        now="2026-06-21T00:00:00Z",
    )

    prompt, design_abs, cwd, err = await _build(
        str(module_folder),
        is_doc_chat=True,
        doc_rel_path="LLD.html",
        persist_task_id=TASK_ID,
    )

    assert err is None
    assert cwd == str(design_dir)
    assert design_abs == str(design_dir)
    assert "LLD.html" in prompt
    assert "in place" in prompt


async def test_doc_chat_doc_id_disambiguates_among_multiple_roots(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    """doc_id pins the exact registered copy when one task has the same
    rel_path under more than one root — a worktree and the canonical folder."""
    module_folder = tmp_path / "repo"
    canonical = module_folder / "spec/platform--m1/T42--stub-task"
    worktree = tmp_path / "wt" / "spec/platform--m1/T42--stub-task"
    canonical.mkdir(parents=True)
    worktree.mkdir(parents=True)
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)

    from apps.documents import dao as ddao

    # Same (task_id, module_id, rel_path) under two distinct roots. The worktree
    # copy is registered LAST, so a -updated_at tiebreak would pick it.
    await ddao.upsert_document(
        doc_id="canon",
        module_id=MODULE_ID,
        task_id=TASK_ID,
        scope="task",
        root_dir=str(canonical),
        rel_path="LLD.html",
        discovered_by_run_id=None,
        now="2026-06-21T00:00:00Z",
    )
    await ddao.upsert_document(
        doc_id="wt",
        module_id=MODULE_ID,
        task_id=TASK_ID,
        scope="task",
        root_dir=str(worktree),
        rel_path="LLD.html",
        discovered_by_run_id=None,
        now="2026-06-22T00:00:00Z",
    )

    # The user opened the canonical copy: its id resolves to its own root,
    # not the more-recently-updated worktree copy.
    _, _, cwd, err = await _build(
        str(module_folder),
        is_doc_chat=True,
        doc_rel_path="LLD.html",
        doc_id="canon",
        persist_task_id=TASK_ID,
    )

    assert err is None
    assert cwd == str(canonical)


async def test_doc_chat_prompt_degrades_without_registry_row(
    tmp_config, sample_profile, tmp_path, monkeypatch
):
    """No registry row → no cwd/design dir, but the launch still proceeds."""
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    profile = dict(sample_profile)
    profile["module_folders"] = {MODULE_ID: str(module_folder)}
    write_profiles(tmp_config, [profile], recent=0)

    prompt, design_abs, cwd, err = await _build(
        str(module_folder),
        is_doc_chat=True,
        doc_rel_path="never-registered.html",
        persist_task_id=TASK_ID,
    )

    assert err is None
    assert cwd is None
    assert design_abs is None
    assert "never-registered.html" in prompt


async def test_doc_chat_spawn_persists_scope_and_doc_path(configured, monkeypatch):
    """A doc-chat spawn records scope=docchat and the doc path on the session."""
    import apps.terminals.consumers as consumers

    _patch_repo(monkeypatch)
    _patch_agent_argv(monkeypatch)(lambda agent, prompt: ["claude", "--prompt", prompt])

    created: dict = {}

    def fake_create_session(**kwargs):
        created.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(consumers.tmux, "create_session", fake_create_session)
    monkeypatch.setattr(consumers.tmux, "attach_argv", lambda rid: ["printf", "ok"])
    monkeypatch.setattr(consumers.tmux, "refresh_client_size", lambda rid, cols, rows: None)

    communicator = await _communicator()
    await communicator.send_to(
        text_data=json.dumps(
            _init_frame(is_doc_chat=True, doc_rel_path="LLD.html", task_id=TASK_ID)
        )
    )
    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    await _drain_until_close(communicator)

    assert created["scope"] == "docchat"
    assert created["doc_rel_path"] == "LLD.html"
    assert created["task_id"] == TASK_ID
    await _wait_until(lambda: not consumers.SESSIONS)
    await communicator.disconnect()
