from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from asgiref.sync import async_to_sync

import apps.terminals.session as session_module
import apps.terminals.agents.registry as agent_registry
from apps.runs.models import AgentRun
from apps.terminals.tests.fakes import InMemorySessionService
from apps.terminals.models import AgentTerminalSession
from apps.terminals.session import LaunchIntent, TerminalSessionService
from apps.terminals.session_registry import SESSIONS, TMUX_VIEWERS
from apps.terminals.tmux.metadata import TmuxSession
from apps.terminals.tmux.sessions import ReconcileResult
from worktracker.tests.factories import fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)


def _insert_run(run_id: str, *, task_id: str = "task-1") -> None:
    AgentRun.objects.create(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id=task_id
        ),
        agent="claude",
        status="running",
        started_at="2026-07-05T10:00:00+00:00",
        cwd="/tmp",
        scope="task",
    )


def _has_live_run(service, task_id: str, adapter_kind: str) -> bool:
    """Whether a running run exists for ``task_id``.

    Replaces the deleted ``TerminalSessionService.live_run_for``, which existed
    only for these assertions. The real service is backed by the ORM; the
    in-memory fake keeps its runs in a dict, so the probe has to know which.
    """

    if adapter_kind == "real":
        return AgentRun.objects.filter(issue_id=task_id, status="running").exists()
    return any(
        run.task_id == task_id and run.status == "running"
        for run in service.runs.values()
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


def test_terminate_is_idempotent_and_marks_run(monkeypatch, tmp_path):
    service = TerminalSessionService()
    _insert_run("run-1")
    _insert_session("run-1")
    monkeypatch.setattr(agent_registry.tempfile, "tempdir", str(tmp_path))
    overlay = _create_overlay(tmp_path, "run-1")
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
    # The lifecycle axis is stamped too, not left on the last hook report: only
    # Claude emits a session-end event, so Codex/agy/gemini runs would otherwise
    # render forever as working or awaiting input (#1462).
    assert run.lifecycle_state == "exited"
    assert run.lifecycle_updated_at == run.ended_at
    assert terminal.terminated_at is not None
    assert not overlay.exists()


def _create_overlay(tmp_path: Path, run_id: str) -> Path:
    overlay = (
        tmp_path
        / "ticketry-agent-runs"
        / run_id
        / "invocation-test"
    )
    overlay.mkdir(parents=True)
    (overlay / "settings.json").write_bytes(b"temporary")
    return overlay


def test_terminate_removes_overlay_even_when_run_is_already_inactive(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(agent_registry.tempfile, "tempdir", str(tmp_path))
    overlay = _create_overlay(tmp_path, "run-inactive")

    TerminalSessionService().terminate("run-inactive")

    assert not overlay.exists()
    assert not (tmp_path / "ticketry-agent-runs" / "run-inactive").exists()


def test_reconcile_stops_watchers_and_marks_dead_runs_exited(monkeypatch):
    service = TerminalSessionService()
    _insert_run("run-dead")
    _insert_session("run-dead")
    stopped: list[str] = []

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(soft_deleted=["run-dead"]),
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
    assert run.lifecycle_state == "exited"
    assert run.lifecycle_updated_at == run.ended_at


def test_reconcile_publishes_retained_provider_exit_as_exited(monkeypatch):
    service = TerminalSessionService()
    _insert_run("run-complete")
    _insert_session("run-complete")
    published: list[tuple[str, str, str]] = []

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(
            soft_deleted=[],
            exited=["run-complete"],
        ),
    )
    monkeypatch.setattr(session_module.documents_watch, "stop_watch", lambda run_id: None)
    monkeypatch.setattr(
        session_module,
        "publish_backend_session_sync",
        lambda project_id, run_id, status, **kwargs: published.append(
            (project_id, run_id, status)
        ),
    )

    result = service.reconcile()

    run = AgentRun.objects.get(id="run-complete")
    assert result.exited == ["run-complete"]
    assert run.status == "exited"
    assert run.ended_at is not None
    assert published == [(fixture_uuid("proj-1"), "run-complete", "exited")]


def test_reconcile_removes_stale_overlays_and_preserves_active_ones(
    monkeypatch, tmp_path
):
    service = TerminalSessionService()
    _insert_run("run-active")
    _insert_session("run-active")
    active_overlay = _create_overlay(tmp_path, "run-active")
    stale_overlay = _create_overlay(tmp_path, "run-stale")
    monkeypatch.setattr(agent_registry.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(soft_deleted=[]),
    )

    service.reconcile()

    assert active_overlay.exists()
    assert not stale_overlay.exists()
    assert not (tmp_path / "ticketry-agent-runs" / "run-stale").exists()


def test_reconcile_never_invokes_explicit_termination(monkeypatch):
    service = TerminalSessionService()

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: ReconcileResult(soft_deleted=[], untracked=["pt-foreign"]),
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("reconciliation must not terminate a session"),
    )

    result = service.reconcile()

    assert result.untracked == ["pt-foreign"]

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
            lambda: ReconcileResult(soft_deleted=["run-dead"]),
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

    task_1_lookup = (
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")
        if adapter_kind == "real"
        else "task-1"
    )
    task_2_lookup = (
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-2")
        if adapter_kind == "real"
        else "task-2"
    )
    assert _has_live_run(service, task_1_lookup, adapter_kind)
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
    assert not _has_live_run(service, task_2_lookup, adapter_kind)
    if adapter_kind == "real":
        assert stopped == [dead_run_id]
    else:
        assert service.stopped_watchers == [dead_run_id]

    # Terminate is idempotent (second call no-op) and the run is no longer live.
    service.terminate(run_id)
    service.terminate(run_id)
    assert not _has_live_run(service, task_1_lookup, adapter_kind)
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
