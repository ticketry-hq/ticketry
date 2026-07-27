from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from asgiref.sync import async_to_sync

import apps.terminals.session as session_module
from apps.runs.models import AgentRun
from apps.terminals.fakes import InMemorySessionService
from apps.terminals.models import AgentTerminalSession
from apps.terminals.session import LaunchIntent, TerminalSessionService
from apps.terminals.session_registry import SESSIONS, TMUX_VIEWERS
from apps.terminals.tmux.metadata import TmuxSession
from apps.terminals.tmux.sessions import ReconcileResult


pytestmark = pytest.mark.django_db(transaction=True)


def _insert_run(run_id: str, *, task_id: str = "task-1") -> None:
    AgentRun.objects.create(
        id=run_id,
        workspace_slug="ws",
        project_id="proj-1",
        module_id="mod-1",
        task_id=task_id,
        agent="claude",
        status="running",
        started_at="2026-07-05T10:00:00+00:00",
        cwd="/tmp",
    )


def _insert_idle_run(
    run_id: str,
    *,
    task_id: str = "task-1",
    provider_session_id: str | None = "sess-1",
    lifecycle_updated_at: str | None = "2026-07-04T10:00:00+00:00",
) -> None:
    AgentRun.objects.create(
        id=run_id,
        workspace_slug="ws",
        project_id="proj-1",
        module_id="mod-1",
        task_id=task_id,
        agent="claude",
        status="running",
        started_at="2026-07-05T10:00:00+00:00",
        cwd="/tmp",
        provider_session_id=provider_session_id,
        lifecycle_updated_at=lifecycle_updated_at,
    )


def _insert_session(run_id: str, *, task_id: str = "task-1") -> None:
    AgentTerminalSession.objects.create(
        agent_run_id=run_id,
        tmux_session_name=f"pt-{run_id}",
        task_id=task_id,
        module_id="mod-1",
        project_id="proj-1",
        agent="claude",
        created_at="2026-07-05T10:00:00+00:00",
        scope="task",
    )


def _tmux_session(run_id: str = "run-1") -> TmuxSession:
    return TmuxSession(
        name=f"pt-{run_id}",
        agent_run_id=run_id,
        task_id="task-1",
        module_id="mod-1",
        project_id="proj-1",
        agent="claude",
        created_at=datetime.now(timezone.utc),
        scope="task",
    )


@pytest.fixture(autouse=True)
def clear_viewers():
    SESSIONS.clear()
    TMUX_VIEWERS.clear()
    yield
    SESSIONS.clear()
    TMUX_VIEWERS.clear()


def test_terminate_is_idempotent_and_marks_run(monkeypatch):
    service = TerminalSessionService()
    _insert_run("run-1")
    _insert_session("run-1")
    killed: list[str] = []
    stopped: list[str] = []

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: killed.append(run_id) or True,
    )
    monkeypatch.setattr(
        session_module.documents_watch,
        "stop_watch",
        lambda run_id: stopped.append(run_id),
    )

    service.terminate("run-1")
    service.terminate("run-1")

    run = AgentRun.objects.get(id="run-1")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-1")
    assert killed == ["run-1"]
    assert stopped == ["run-1"]
    assert run.status == "terminated"
    assert run.ended_at is not None
    assert terminal.terminated_at is not None


def test_reconcile_stops_watchers_and_marks_dead_runs_exited(monkeypatch):
    service = TerminalSessionService()
    _insert_run("run-dead")
    _insert_session("run-dead")
    stopped: list[str] = []

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(soft_deleted=["run-dead"], killed_orphans=[]),
    )
    monkeypatch.setattr(
        session_module.documents_watch,
        "stop_watch",
        lambda run_id: stopped.append(run_id),
    )

    result = service.reconcile()

    run = AgentRun.objects.get(id="run-dead")
    assert result.soft_deleted == ["run-dead"]
    assert stopped == ["run-dead"]
    assert run.status == "exited"
    assert run.ended_at is not None


def test_reap_idle_sessions_reaps_idle_resumable_unattached(monkeypatch):
    service = TerminalSessionService()
    _insert_idle_run("run-idle")
    _insert_session("run-idle")
    killed: list[str] = []
    stopped: list[str] = []

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", "24")
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "attached_session_names",
        lambda: set(),
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: killed.append(run_id) or True,
    )
    monkeypatch.setattr(
        session_module.documents_watch,
        "stop_watch",
        lambda run_id: stopped.append(run_id),
    )

    reaped = service.reap_idle_sessions(
        now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
    )

    run = AgentRun.objects.get(id="run-idle")
    terminal = AgentTerminalSession.objects.get(agent_run_id="run-idle")
    assert reaped == ["run-idle"]
    assert killed == ["run-idle"]
    assert stopped == ["run-idle"]
    assert run.status == "terminated"
    assert run.ended_at is not None
    assert terminal.terminated_at is not None


@pytest.mark.parametrize("provider_session_id", [None, ""])
def test_reap_idle_sessions_keeps_unresumable_runs(monkeypatch, provider_session_id):
    service = TerminalSessionService()
    _insert_idle_run("run-unresumable", provider_session_id=provider_session_id)
    _insert_session("run-unresumable")

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", "24")
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("terminate_session should not be called"),
    )

    assert (
        service.reap_idle_sessions(
            now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
        )
        == []
    )


@pytest.mark.parametrize(
    "lifecycle_updated_at",
    [
        "2026-07-07T09:30:00+00:00",
        None,
        "not-an-iso-timestamp",
    ],
)
def test_reap_idle_sessions_keeps_fresh_or_unparseable_runs(
    monkeypatch, lifecycle_updated_at
):
    service = TerminalSessionService()
    _insert_idle_run("run-not-old", lifecycle_updated_at=lifecycle_updated_at)
    _insert_session("run-not-old")

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", "24")
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "attached_session_names",
        lambda: set(),
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("terminate_session should not be called"),
    )

    assert (
        service.reap_idle_sessions(
            now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
        )
        == []
    )


def test_reap_idle_sessions_keeps_attached_runs(monkeypatch):
    service = TerminalSessionService()
    _insert_idle_run("run-attached")
    _insert_session("run-attached")

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", "24")
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "attached_session_names",
        lambda: {"pt-run-attached"},
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("terminate_session should not be called"),
    )

    assert (
        service.reap_idle_sessions(
            now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
        )
        == []
    )


def test_reap_idle_sessions_keeps_runs_when_attachment_state_is_indeterminate(
    monkeypatch,
):
    service = TerminalSessionService()
    _insert_idle_run("run-unknown")
    _insert_session("run-unknown")

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", "24")
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "attached_session_names",
        lambda: (_ for _ in ()).throw(session_module.TmuxSessionError("boom")),
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("terminate_session should not be called"),
    )

    assert (
        service.reap_idle_sessions(
            now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
        )
        == []
    )


@pytest.mark.parametrize("ttl_value", ["0", "junk", "-1"])
def test_reap_idle_sessions_disables_on_bad_ttl(monkeypatch, ttl_value):
    service = TerminalSessionService()
    _insert_idle_run("run-disabled")
    _insert_session("run-disabled")

    monkeypatch.setenv("MUXED_IDLE_TTL_HOURS", ttl_value)
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "attached_session_names",
        lambda: pytest.fail("attached_session_names should not be called"),
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("terminate_session should not be called"),
    )

    assert (
        service.reap_idle_sessions(
            now=datetime(2026, 7, 7, 10, 0, tzinfo=timezone.utc)
        )
        == []
    )


def test_live_run_for_returns_running_run_then_none_after_terminate(monkeypatch):
    service = TerminalSessionService()
    _insert_run("run-live")
    _insert_session("run-live")
    monkeypatch.setattr(session_module.tmux_sessions, "terminate_session", lambda run_id: True)
    monkeypatch.setattr(session_module.documents_watch, "stop_watch", lambda run_id: None)

    assert service.live_run_for("task-1").id == "run-live"

    service.terminate("run-live")

    assert service.live_run_for("task-1") is None


def test_reconcile_invokes_idle_reaper(monkeypatch):
    service = TerminalSessionService()
    called: list[bool] = []

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(soft_deleted=[], killed_orphans=[]),
    )
    monkeypatch.setattr(
        service,
        "reap_idle_sessions",
        lambda *, now=None: called.append(True) or [],
    )

    service.reconcile()

    assert called == [True]


def test_attach_replaces_existing_viewer_and_release_is_idempotent(monkeypatch):
    service = TerminalSessionService()
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "get_session",
        lambda run_id: _tmux_session(run_id),
    )

    first = service.attach("run-1")
    first_session = SimpleNamespace(agent_run_id="run-1", session_id=first.viewer_id)
    first.activate(first_session)

    second = service.attach("run-1")
    second_session = SimpleNamespace(agent_run_id="run-1", session_id=second.viewer_id)
    assert second.activate(second_session) is first_session
    assert TMUX_VIEWERS == {"run-1": second.viewer_id}

    first.release()
    assert TMUX_VIEWERS == {"run-1": second.viewer_id}
    first.release()
    second.release()


@pytest.mark.parametrize("adapter_kind", ["real", "fake"])
def test_session_contract_shared_behaviors(adapter_kind, monkeypatch):
    killed: list[str] = []
    stopped: list[str] = []
    if adapter_kind == "real":
        service = TerminalSessionService()
        _insert_run("run-contract")
        _insert_session("run-contract")
        _insert_run("run-dead", task_id="task-2")
        _insert_session("run-dead", task_id="task-2")
        monkeypatch.setattr(
            session_module.tmux_sessions,
            "terminate_session",
            lambda run_id: killed.append(run_id) or True,
        )
        monkeypatch.setattr(
            session_module.tmux_sessions,
            "get_session",
            lambda run_id: _tmux_session(run_id),
        )
        monkeypatch.setattr(
            session_module.tmux_sessions,
            "reconcile_sessions",
            lambda: ReconcileResult(soft_deleted=["run-dead"], killed_orphans=[]),
        )
        monkeypatch.setattr(
            session_module.documents_watch,
            "stop_watch",
            lambda run_id: stopped.append(run_id),
        )
        run_id = "run-contract"
        dead_run_id = "run-dead"
    else:
        service = InMemorySessionService()
        run_id = async_to_sync(async_spawn_fake)(service)
        dead_run_id = async_to_sync(async_spawn_fake)(service, task_id="task-2")

    assert service.live_run_for("task-1") is not None
    first = service.attach(run_id)
    first_session = SimpleNamespace(
        agent_run_id=run_id,
        session_id=first.viewer_id,
    )
    first.activate(first_session)
    replacement = service.attach(run_id)
    replacement_session = SimpleNamespace(
        agent_run_id=run_id,
        session_id=replacement.viewer_id,
    )
    assert replacement.activate(replacement_session) is first_session
    first.release()
    first.release()
    replacement.release()

    # Reconcile stops watchers for dead sessions and the dead run is no longer live.
    if adapter_kind == "fake":
        service.sessions[dead_run_id].dead = True
    service.reconcile()
    assert service.live_run_for("task-2") is None
    if adapter_kind == "real":
        assert stopped == [dead_run_id]
    else:
        assert service.stopped_watchers == [dead_run_id]

    # Terminate is idempotent (second call no-op) and the run is no longer live.
    service.terminate(run_id)
    service.terminate(run_id)
    assert service.live_run_for("task-1") is None
    if adapter_kind == "real":
        assert killed == [run_id]
        assert stopped == [dead_run_id, run_id]
    else:
        assert service.stopped_watchers == [dead_run_id, run_id]


async def async_spawn_fake(service: InMemorySessionService, task_id: str = "task-1") -> str:
    return await service.spawn(
        LaunchIntent(
            agent="claude",
            project_id="proj-1",
            module_id="mod-1",
            task_id=task_id,
        )
    )
