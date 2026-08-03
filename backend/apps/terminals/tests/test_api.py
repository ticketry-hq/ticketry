"""Tests for the four terminal-session REST endpoints."""

from __future__ import annotations

import json
import uuid

import pytest
from django.db import connection

import apps.terminals.agents.registry as registry
import apps.terminals.api as terminals_api
import apps.terminals.launch as launch
from apps.terminals import dao, tmux
import apps.terminals.session as session_module
from apps.terminals.models import AgentTerminalSession
from apps.terminals.authorization import issue_run_authorization
from apps.terminals.validation import SpawnRequest
from apps.runs.models import AgentRun
from worktracker.models import Issue, IssueType, Project, Workspace
from worktracker.tests.factories import ensure_issue, fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)

SCRATCH_TASK_ID = dao.SCRATCH_TASK_ID


def _create_module_issue() -> Issue:
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug=f"ws-{uuid.uuid4().hex}", name="Workspace"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Project", slug="PROJ"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )


def _insert_run(
    run_id,
    *,
    task_id="task-1",
    project_id="proj-1",
    module_id="mod-1",
    lifecycle_state=None,
    started_at="2026-05-29T10:00:00",
    ended_at=None,
    provider_session_id=None,
    resumed_from=None,
    status=None,
):
    """Insert a parent agent_run for terminal-session rows."""

    issue = ensure_issue(
        project_id=project_id,
        module_id=module_id,
        task_id=None if task_id == SCRATCH_TASK_ID else task_id,
    )
    AgentRun.objects.create(
        id=run_id,
        issue=issue,
        ticket_seq=484,
        agent="claude-code",
        status=status or ("terminated" if ended_at is not None else "running"),
        started_at=started_at,
        ended_at=ended_at,
        cwd="/tmp",
        provider_session_id=provider_session_id,
        lifecycle_state=lifecycle_state,
        resumed_from=resumed_from,
        scope="plan" if task_id == SCRATCH_TASK_ID else "task",
    )


def _insert_session(
    run_id,
    *,
    task_id,
    created_at,
    agent,
    project_id="proj-1",
    module_id="mod-1",
    scope="task",
    terminated_at=None,
    doc_rel_path=None,
):
    AgentTerminalSession.objects.create(
        agent_run_id=run_id,
        tmux_session_name=f"pt-{run_id}",
        task_id=task_id,
        module_id=module_id,
        project_id=project_id,
        agent=agent,
        created_at=created_at,
        scope=scope,
        terminated_at=terminated_at,
        doc_rel_path=doc_rel_path,
    )
    AgentRun.objects.filter(id=run_id).update(scope=scope)


def _no_reconcile(monkeypatch):
    """Stub reconcile so test rows are not soft-deleted for lacking tmux."""

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "reconcile_sessions",
        lambda: tmux.ReconcileResult([], []),
    )


def _create_body(**overrides):
    body = {
        "agent": "claude",
        "project_id": "proj-1",
        "module_id": "mod-1",
        "task_id": "task-1",
        "initial_prompt": "Start work",
        "is_planning": False,
        "is_instant": False,
        "instant_prompt": None,
        "is_doc_chat": False,
        "doc_rel_path": None,
        "doc_id": None,
    }
    body.update(overrides)
    return body


def test_create_terminal_run_calls_shared_control_plane(client, monkeypatch):
    captured: list = []

    async def fake_create(request) -> str:
        captured.append(request)
        return "run-new"

    monkeypatch.setattr(terminals_api, "create_terminal_run", fake_create)

    response = client.post(
        "/api/terminals",
        data=json.dumps(_create_body()),
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"agent_run_id": "run-new"}
    # The control plane receives the same normalized value the WebSocket spawn
    # branch builds — a typed request, not a dict of string keys.
    assert captured == [
        SpawnRequest(
            agent="claude",
            project_id="proj-1",
            module_id="mod-1",
            task_id="task-1",
            initial_prompt="Start work",
            cols=1,
            rows=1,
            is_planning=False,
            is_instant=False,
            instant_prompt=None,
            is_doc_chat=False,
            doc_rel_path=None,
            doc_id=None,
        )
    ]


def test_create_terminal_run_reuses_spawn_validation(client):
    response = client.post(
        "/api/terminals",
        data=json.dumps(_create_body(agent="unknown")),
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json() == {"detail": {"error": "unknown_agent"}}


def test_create_terminal_run_surfaces_shared_launcher_failure(client, monkeypatch):
    async def failed_create(request) -> str:
        del request
        raise launch.LaunchUnavailable("tmux failed")

    monkeypatch.setattr(terminals_api, "create_terminal_run", failed_create)

    response = client.post(
        "/api/terminals",
        data=json.dumps(_create_body()),
        content_type="application/json",
    )

    assert response.status_code == 500
    assert response.json() == {
        "detail": {"error": "launch_unavailable", "message": "tmux failed"}
    }


def test_list_terminals_returns_active_sessions(client, monkeypatch):
    _no_reconcile(monkeypatch)

    _insert_run("run-old")
    _insert_run("run-new")
    _insert_run("run-deleted")
    _insert_session(
        "run-old",
        task_id="task-1",
        created_at="2026-05-29T09:00:00",
        agent="claude-code",
    )
    _insert_session(
        "run-new", task_id="task-1", created_at="2026-05-29T11:00:00", agent="codex"
    )
    _insert_session(
        "run-deleted",
        task_id="task-1",
        created_at="2026-05-29T12:00:00",
        agent="gemini",
        terminated_at="2026-05-29T12:30:00",
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == ["run-new", "run-old"]


def test_list_terminals_serializes_doc_chat_fields(client, monkeypatch):
    """A doc-chat row exposes scope=docchat + doc_rel_path for restore (#625)."""
    _no_reconcile(monkeypatch)

    _insert_run("doc-run")
    _insert_session(
        "doc-run",
        task_id="task-1",
        created_at="2026-05-29T09:00:00",
        agent="claude-code",
        scope="docchat",
        doc_rel_path="spec/x/LLD.html",
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    row = response.json()[0]
    assert row["scope"] == "docchat"
    assert row["doc_rel_path"] == "spec/x/LLD.html"


def test_list_terminals_reconciles_dead_session_before_responding(client, monkeypatch):
    """GET /api/terminals reaps a dead session so it is not offered."""

    _insert_run("run-live")
    _insert_run("run-dead")
    _insert_session(
        "run-live",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )
    _insert_session(
        "run-dead", task_id="task-1", created_at="2026-05-29T11:00:00", agent="codex"
    )

    # Fake reconcile soft-deletes the dead row, mirroring real reaper behavior
    # without needing a tmux binary; the route must call it before listing.
    reconcile_calls: list[int] = []

    def fake_reconcile():
        reconcile_calls.append(1)
        dao_soft_delete("run-dead", "2026-05-29T12:00:00")
        return tmux.ReconcileResult(soft_deleted=["run-dead"])

    monkeypatch.setattr(
        session_module.tmux_sessions, "reconcile_sessions", fake_reconcile
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert reconcile_calls == [1]
    assert [row["agent_run_id"] for row in response.json()] == ["run-live"]


def test_list_terminals_survives_reconcile_failure(client, monkeypatch):
    """A reaper error degrades to returning the unreconciled list, not a 500."""

    _insert_run("run-live")
    _insert_session(
        "run-live",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )

    def boom():
        raise RuntimeError("tmux exploded")

    monkeypatch.setattr(session_module.tmux_sessions, "reconcile_sessions", boom)

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == ["run-live"]


def test_list_scratch_terminals_returns_active_no_task_sessions(client, monkeypatch):
    """GET /api/terminals/scratch lists active sentinel-task sessions by module."""

    _no_reconcile(monkeypatch)

    # A scratch run and a task-bound run share one module.
    _insert_run("scratch-run", task_id=SCRATCH_TASK_ID)
    _insert_run("task-run", task_id="task-1")
    _insert_session(
        "scratch-run",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
    )
    _insert_session(
        "task-run", task_id="task-1", created_at="2026-05-29T11:00:00", agent="codex"
    )

    resp = client.get(
        "/api/terminals/scratch",
        {"project_id": "proj-1", "module_id": "mod-1"},
    )

    assert resp.status_code == 200
    rows = resp.json()
    assert [r["agent_run_id"] for r in rows] == ["scratch-run"]
    assert rows[0]["scope"] == "plan"
    assert rows[0]["task_id"] == SCRATCH_TASK_ID

    # Regression: the task-bound list never includes the scratch session.
    task_resp = client.get("/api/terminals", {"task_id": "task-1"})
    assert [r["agent_run_id"] for r in task_resp.json()] == ["task-run"]


def test_list_scratch_terminals_can_hydrate_all_project_modules(client, monkeypatch):
    _no_reconcile(monkeypatch)
    _insert_run("scratch-one", task_id=SCRATCH_TASK_ID)
    _insert_run("scratch-two", task_id=SCRATCH_TASK_ID)
    _insert_session(
        "scratch-one",
        task_id=SCRATCH_TASK_ID,
        module_id="mod-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
    )
    _insert_session(
        "scratch-two",
        task_id=SCRATCH_TASK_ID,
        module_id="mod-2",
        created_at="2026-05-29T11:00:00",
        agent="codex",
        scope="instant",
    )

    response = client.get("/api/terminals/scratch", {"project_id": "proj-1"})

    assert response.status_code == 200
    assert {row["module_id"] for row in response.json()} == {"mod-1", "mod-2"}


def test_resume_terminal_returns_new_and_old_ids(client, monkeypatch):
    async def fake_resume(agent_run_id: str) -> str:
        assert agent_run_id == "run-old"
        return "run-new"

    monkeypatch.setattr(terminals_api.terminal_session, "resume", fake_resume)

    response = client.post("/api/terminals/resume?agent_run_id=run-old")

    assert response.status_code == 200
    assert response.json() == {
        "agent_run_id": "run-new",
        "resumed_from": "run-old",
    }


@pytest.mark.parametrize(
    ("exc", "status_code", "payload"),
    [
        (
            session_module.ResumeUnavailable("unknown_run"),
            404,
            {"detail": {"error": "unknown_run"}},
        ),
        (
            session_module.ResumeUnavailable("run_still_active"),
            409,
            {"detail": {"error": "run_still_active"}},
        ),
        (
            session_module.ResumeUnavailable("no_provider_session_id"),
            409,
            {"detail": {"error": "no_provider_session_id"}},
        ),
        (
            session_module.ResumeUnavailable("cwd_missing"),
            409,
            {"detail": {"error": "cwd_missing"}},
        ),
        (
            registry.ResumeUnsupported("claude"),
            409,
            {"detail": {"error": "resume_unsupported"}},
        ),
        (
            launch.LaunchUnavailable("tmux failed"),
            500,
            {"detail": {"error": "launch_unavailable", "message": "tmux failed"}},
        ),
        (
            registry.UnknownAgent("bogus"),
            409,
            {"detail": {"error": "unknown_agent"}},
        ),
    ],
)
def test_resume_terminal_maps_errors(client, monkeypatch, exc, status_code, payload):
    async def fake_resume(agent_run_id: str) -> str:
        raise exc

    monkeypatch.setattr(terminals_api.terminal_session, "resume", fake_resume)

    response = client.post("/api/terminals/resume?agent_run_id=run-old")

    assert response.status_code == status_code
    assert response.json() == payload


def test_list_resumable_terminals_filters_collapses_and_excludes_live(client):
    _insert_run(
        "plain-run",
        task_id="task-1",
        ended_at="2026-05-29T12:00:00",
        provider_session_id="sess-plain",
        resumed_from=None,
    )
    _insert_run(
        "chain-a",
        task_id="task-1",
        started_at="2026-05-29T10:30:00",
        ended_at="2026-05-29T11:00:00",
        provider_session_id="sess-chain",
        resumed_from="seed",
    )
    _insert_run(
        "chain-b",
        task_id="task-1",
        started_at="2026-05-29T12:30:00",
        ended_at="2026-05-29T13:00:00",
        provider_session_id="sess-chain",
        resumed_from="chain-a",
    )
    _insert_run(
        "live-active",
        task_id="task-1",
        provider_session_id="sess-live",
        status="running",
    )
    _insert_run(
        "live-terminated",
        task_id="task-1",
        ended_at="2026-05-29T10:30:00",
        provider_session_id="sess-live",
    )
    _insert_run(
        "no-provider",
        task_id="task-1",
        ended_at="2026-05-29T09:00:00",
        provider_session_id=None,
    )

    response = client.get(
        "/api/terminals/resumable",
        {
            "task_id": fixture_issue_id(
                project_id="proj-1", module_id="mod-1", task_id="task-1"
            )
        },
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "agent_run_id": "chain-b",
            "agent": "claude-code",
            "status": "terminated",
            "started_at": "2026-05-29T12:30:00",
            "ended_at": "2026-05-29T13:00:00",
            "provider_session_id": "sess-chain",
            "resumed_from": "chain-a",
            "scope": "task",
        },
        {
            "agent_run_id": "plain-run",
            "agent": "claude-code",
            "status": "terminated",
            "started_at": "2026-05-29T10:00:00",
            "ended_at": "2026-05-29T12:00:00",
            "provider_session_id": "sess-plain",
            "resumed_from": None,
            "scope": "task",
        },
    ]


def test_list_resumable_terminals_excludes_run_resumed_by_live_successor(client):
    # Just-resumed window: the live successor exists but its hooks have not
    # fired yet, so it has no provider_session_id. The old run must still
    # disappear from the resumable list via the resumed_from link.
    _insert_run(
        "old-resumed",
        task_id="task-1",
        ended_at="2026-05-29T12:00:00",
        provider_session_id="sess-old",
    )
    _insert_run(
        "live-successor",
        task_id="task-1",
        provider_session_id=None,
        status="running",
        resumed_from="old-resumed",
    )

    response = client.get(
        "/api/terminals/resumable",
        {
            "task_id": fixture_issue_id(
                project_id="proj-1", module_id="mod-1", task_id="task-1"
            )
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_list_resumable_terminals_orders_newest_first_and_caps_at_ten(client):
    for idx in range(1, 13):
        _insert_run(
            f"run-{idx:02d}",
            task_id="task-2",
            started_at=f"2026-05-29T{idx:02d}:00:00",
            ended_at=f"2026-05-29T{idx:02d}:30:00",
            provider_session_id=f"sess-{idx:02d}",
            resumed_from=None,
        )

    response = client.get(
        "/api/terminals/resumable",
        {
            "task_id": fixture_issue_id(
                project_id="proj-1", module_id="mod-1", task_id="task-2"
            )
        },
    )

    assert response.status_code == 200
    rows = response.json()
    assert [row["agent_run_id"] for row in rows] == [
        "run-12",
        "run-11",
        "run-10",
        "run-09",
        "run-08",
        "run-07",
        "run-06",
        "run-05",
        "run-04",
        "run-03",
    ]


def test_list_resumable_terminals_can_scope_scratch_runs_by_project_and_module(client):
    _insert_run(
        "scratch-plan",
        task_id=SCRATCH_TASK_ID,
        project_id="project-1",
        module_id="module-1",
        ended_at="2026-05-29T12:00:00",
        provider_session_id="sess-plan",
    )
    _insert_session(
        "scratch-plan",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        project_id="project-1",
        module_id="module-1",
        scope="plan",
        terminated_at="2026-05-29T12:00:00",
    )
    _insert_run(
        "scratch-instant",
        task_id=SCRATCH_TASK_ID,
        project_id="project-1",
        module_id="module-1",
        ended_at="2026-05-29T12:30:00",
        provider_session_id="sess-instant",
    )
    _insert_session(
        "scratch-instant",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:30:00",
        agent="claude-code",
        project_id="project-1",
        module_id="module-1",
        scope="instant",
        terminated_at="2026-05-29T12:30:00",
    )
    _insert_run(
        "other-module",
        task_id=SCRATCH_TASK_ID,
        project_id="project-1",
        module_id="module-2",
        ended_at="2026-05-29T13:00:00",
        provider_session_id="sess-other",
    )
    _insert_session(
        "other-module",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T11:00:00",
        agent="claude-code",
        project_id="project-1",
        module_id="module-2",
        scope="plan",
        terminated_at="2026-05-29T13:00:00",
    )

    response = client.get(
        "/api/terminals/resumable",
        {
            "project_id": fixture_uuid("project-1"),
            "module_id": fixture_issue_id(
                project_id="project-1", module_id="module-1", task_id=None
            ),
        },
    )

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == [
        "scratch-instant",
        "scratch-plan",
    ]


def test_list_resumable_module_runs_preserves_plan_and_instant_scope(client):
    module = _create_module_issue()
    for run_id, scope, hour in (
        ("module-plan", "plan", 10),
        ("module-instant", "instant", 11),
    ):
        AgentRun.objects.create(
            id=run_id,
            issue=module,
            agent="claude",
            status="terminated",
            scope=scope,
            started_at=f"2026-05-29T{hour:02d}:00:00",
            ended_at=f"2026-05-29T{hour:02d}:30:00",
            provider_session_id=f"provider-{scope}",
        )

    response = client.get(
        "/api/terminals/resumable",
        {"project_id": str(module.project_id), "module_id": str(module.id)},
    )

    assert response.status_code == 200
    assert [
        (row["agent_run_id"], row["scope"]) for row in response.json()
    ] == [
        ("module-instant", "instant"),
        ("module-plan", "plan"),
    ]


def test_deleting_issue_cascades_to_agent_runs():
    module = _create_module_issue()
    AgentRun.objects.create(
        id="cascading-run",
        issue=module,
        agent="claude",
        status="running",
        scope="plan",
        started_at="2026-05-29T10:00:00",
    )

    # The unrelated execution app's model state currently references a
    # pre-existing missing `launched_tasks` table. Supply its minimal test-only
    # shape so Django's deletion collector can exercise this FK cascade.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS launched_tasks (
                task_id char(32) PRIMARY KEY,
                root_id char(32) NOT NULL,
                agent_run_id varchar(255) NOT NULL,
                launched_at datetime NOT NULL
            )
            """
        )
    module.delete()

    assert not AgentRun.objects.filter(id="cascading-run").exists()


def test_list_resumable_scratch_runs_filters_scopes_and_caps_newest_ten(client):
    """Scratch chips include only its module's newest plan/instant conversations."""

    for idx in range(1, 13):
        run_id = f"eligible-{idx:02d}"
        ended_at = f"2026-05-29T{idx:02d}:30:00"
        _insert_run(
            run_id,
            task_id=SCRATCH_TASK_ID,
            project_id="project-1",
            module_id="module-1",
            started_at=f"2026-05-29T{idx:02d}:00:00",
            ended_at=ended_at,
            provider_session_id=f"session-{idx:02d}",
        )
        _insert_session(
            run_id,
            task_id=SCRATCH_TASK_ID,
            created_at=f"2026-05-29T{idx:02d}:00:00",
            agent="claude-code",
            project_id="project-1",
            module_id="module-1",
            scope="plan" if idx % 2 else "instant",
            terminated_at=ended_at,
        )

    # Both are newer than every eligible run but belong outside Scratch history.
    _insert_run(
        "scratch-doc-chat",
        task_id=SCRATCH_TASK_ID,
        project_id="project-1",
        module_id="module-1",
        ended_at="2026-05-30T01:00:00",
        provider_session_id="doc-chat-session",
    )
    _insert_session(
        "scratch-doc-chat",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-30T00:00:00",
        agent="claude-code",
        project_id="project-1",
        module_id="module-1",
        scope="docchat",
        terminated_at="2026-05-30T01:00:00",
    )
    _insert_run(
        "other-project",
        task_id=SCRATCH_TASK_ID,
        project_id="project-2",
        module_id="module-1",
        ended_at="2026-05-30T02:00:00",
        provider_session_id="other-project-session",
    )
    _insert_session(
        "other-project",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-30T01:00:00",
        agent="claude-code",
        project_id="project-2",
        module_id="module-1",
        scope="plan",
        terminated_at="2026-05-30T02:00:00",
    )

    response = client.get(
        "/api/terminals/resumable",
        {
            "project_id": fixture_uuid("project-1"),
            "module_id": fixture_issue_id(
                project_id="project-1", module_id="module-1", task_id=None
            ),
        },
    )

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == [
        f"eligible-{idx:02d}" for idx in range(12, 2, -1)
    ]


def test_delete_terminal_terminates_and_soft_deletes(client, monkeypatch):
    _insert_run("run-delete")
    _insert_session(
        "run-delete",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )

    def fake_terminate(agent_run_id):
        dao_soft_delete(agent_run_id, "2026-05-29T10:30:00")
        return True

    monkeypatch.setattr(
        session_module.tmux_sessions, "terminate_session", fake_terminate
    )

    response = client.delete("/api/terminals/?agent_run_id=run-delete")

    assert response.status_code == 200
    assert response.json() == {"agent_run_id": "run-delete", "terminated": True}
    row = AgentTerminalSession.objects.get(agent_run_id="run-delete")
    assert row.terminated_at == "2026-05-29T10:30:00"


def test_self_terminate_ends_only_the_authorized_active_run(client, monkeypatch):
    _insert_run("run-caller")
    _insert_run("run-other")
    _insert_session(
        "run-caller",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
    )
    _insert_session(
        "run-other",
        task_id="task-2",
        created_at="2026-05-29T10:00:00",
        agent="claude",
    )

    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: dao_soft_delete(run_id, "2026-05-29T10:30:00"),
    )

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-caller"),
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "terminated": True,
        "already_terminated": False,
        "agent_run_id": "run-caller",
    }
    assert AgentRun.objects.get(id="run-caller").status == "terminated"
    assert AgentRun.objects.get(id="run-other").status == "running"
    assert (
        AgentTerminalSession.objects.get(agent_run_id="run-other").terminated_at is None
    )


def test_self_terminate_is_idempotent_for_an_inactive_run(client, monkeypatch):
    _insert_run("run-ended", ended_at="2026-05-29T10:30:00")
    _insert_session(
        "run-ended",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
        terminated_at="2026-05-29T10:30:00",
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: pytest.fail("inactive run must not reach tmux"),
    )

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-ended"),
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "terminated": True,
        "already_terminated": True,
        "agent_run_id": "run-ended",
    }


@pytest.mark.parametrize(
    ("authorization", "error"),
    [
        (None, "authorization_missing"),
        ("not-bearer", "authorization_malformed"),
        ("Bearer malformed.token", "authorization_invalid"),
    ],
)
def test_self_terminate_rejects_unbound_callers(
    client, monkeypatch, authorization, error
):
    _insert_run("run-safe")
    _insert_session(
        "run-safe",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
    )
    monkeypatch.setattr(
        terminals_api.terminal_session,
        "terminate",
        lambda run_id: pytest.fail("unbound caller must not terminate a run"),
    )
    headers = {"HTTP_AUTHORIZATION": authorization} if authorization else {}

    response = client.post("/api/terminals/self-terminate", **headers)

    assert response.status_code == 401
    assert response.json() == {
        "ok": False,
        "error": "caller_run_unbound",
        "reason": error,
    }
    assert AgentRun.objects.get(id="run-safe").status == "running"


def test_self_terminate_rejects_a_valid_identity_for_an_unknown_run(
    client, monkeypatch
):
    monkeypatch.setattr(
        terminals_api.terminal_session,
        "terminate",
        lambda run_id: pytest.fail("unknown run must not reach termination"),
    )

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-missing"),
    )

    assert response.status_code == 404
    assert response.json() == {"ok": False, "error": "caller_run_unknown"}


def test_predecessor_identity_cannot_terminate_its_resumed_run(client, monkeypatch):
    _insert_run("run-old", ended_at="2026-05-29T10:30:00")
    _insert_run("run-resumed", resumed_from="run-old")
    _insert_session(
        "run-old",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
        terminated_at="2026-05-29T10:30:00",
    )
    _insert_session(
        "run-resumed",
        task_id="task-1",
        created_at="2026-05-29T10:31:00",
        agent="claude",
    )
    monkeypatch.setattr(
        terminals_api.terminal_session,
        "terminate",
        lambda run_id: pytest.fail("predecessor identity must stay on predecessor"),
    )

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-old"),
    )

    assert response.status_code == 200
    assert response.json()["already_terminated"] is True
    assert AgentRun.objects.get(id="run-resumed").status == "running"
    assert (
        AgentTerminalSession.objects.get(agent_run_id="run-resumed").terminated_at
        is None
    )


def test_mcp_tool_crosses_studio_and_uses_terminal_authority(client, monkeypatch):
    """The zero-arg MCP function reaches Studio and preserves termination effects."""

    import httpx
    import sys
    import types
    from pathlib import Path

    agent_root = (
        Path(__file__).resolve().parents[4]
        / "surfaces"
        / "worktracker-agent"
    )
    agent_package = types.ModuleType("worktracker_agent")
    agent_package.__path__ = [str(agent_root)]
    monkeypatch.setitem(sys.modules, "worktracker_agent", agent_package)

    from worktracker_agent.api.run_control import StudioRunControlService
    from worktracker_agent.mcp import termination

    _insert_run("run-e2e")
    _insert_session(
        "run-e2e",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
    )
    monkeypatch.setattr(
        session_module.tmux_sessions,
        "terminate_session",
        lambda run_id: dao_soft_delete(run_id, "2026-05-29T10:30:00"),
    )
    stopped_watches = []
    published = []
    monkeypatch.setattr(
        session_module.documents_watch, "stop_watch", stopped_watches.append
    )
    monkeypatch.setattr(
        session_module,
        "publish_backend_session_sync",
        lambda *args, **kwargs: published.append((args, kwargs)),
    )

    def studio_endpoint(request):
        response = client.post(
            request.url.path,
            HTTP_AUTHORIZATION=request.headers["Authorization"],
        )
        return httpx.Response(response.status_code, json=response.json())

    run_control = StudioRunControlService(
        url="http://studio.test/api/terminals/self-terminate",
        transport=httpx.MockTransport(studio_endpoint),
    )
    monkeypatch.setattr(
        termination, "get_studio_run_control_service", lambda: run_control
    )
    monkeypatch.setattr(
        termination,
        "_request_authorization",
        lambda: issue_run_authorization("run-e2e"),
    )

    result = termination.terminate_current_run()

    assert result == {
        "ok": True,
        "terminated": True,
        "already_terminated": False,
        "agent_run_id": "run-e2e",
    }
    assert AgentRun.objects.get(id="run-e2e").status == "terminated"
    assert stopped_watches == ["run-e2e"]
    assert published[0][0][:3] == (
        fixture_uuid("proj-1"),
        "run-e2e",
        "exited",
    )


def dao_soft_delete(agent_run_id, terminated_at):
    """Soft-delete a row synchronously for fake reaper/terminate stubs."""

    AgentTerminalSession.objects.filter(
        agent_run_id=agent_run_id,
        terminated_at__isnull=True,
    ).update(terminated_at=terminated_at)
