"""Tests for the four terminal-session REST endpoints."""

from __future__ import annotations

import json
import uuid

import pytest
from django.db import connection
from django.test import override_settings

import apps.terminals.agents.registry as registry
import apps.terminals.api as terminals_api
import apps.terminals.launch as launch
from apps.terminals import dao
import apps.terminals.launch as launch_module
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.models import AgentTerminalSession
from apps.terminals.tests.fakes import patch_terminal_runtime
from apps.terminals.authorization import issue_run_authorization
from apps.terminals.validation import SpawnRequest
from apps.runs.models import AgentRun
from apps.runs.run_scopes import SHELL_SCOPE
from worktracker.models import Issue, IssueType, Project
from worktracker.tests.factories import ensure_issue, fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)

SCRATCH_TASK_ID = dao.SCRATCH_TASK_ID


@pytest.fixture(autouse=True)
def terminal_runtime(monkeypatch):
    return patch_terminal_runtime(monkeypatch)


def _create_module_issue() -> Issue:
    project = Project.objects.create(
        id=uuid.uuid4(), name="Project", slug=f"PROJ-{uuid.uuid4().hex}"
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
    launch_state=None,
    launch_model=None,
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
        launch_state=launch_state,
        launch_model=launch_model,
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
    runtime_namespace="test",
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
        runtime_namespace=runtime_namespace,
    )
    AgentRun.objects.filter(id=run_id).update(scope=scope)


def _no_background_reconcile(monkeypatch):
    """Keep list tests from starting a real background reconciliation."""

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        lambda: False,
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
    assert response.json() == {"detail": "unknown_agent", "code": "unknown_agent"}


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
        "detail": "tmux failed",
        "code": "launch_unavailable",
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_scratch_launch_required_skill_collision_returns_structured_409(
    client, monkeypatch
):
    async def rejected_create(request) -> str:
        del request
        raise RequiredSkillUnavailable(
            provider="codex",
            skill="code-review",
            reason="collision",
            message="A different provider-visible skill already reserves 'code-review'.",
        )

    monkeypatch.setattr(terminals_api, "create_terminal_run", rejected_create)
    response = client.post(
        "/api/terminals",
        data=json.dumps(
            _create_body(
                agent="codex",
                task_id=None,
                is_planning=True,
                initial_prompt=None,
            )
        ),
        content_type="application/json",
    )

    assert response.status_code == 409
    assert response.json()["code"] == "required_skill_unavailable"
    assert response.json()["provider"] == "codex"
    assert response.json()["skill"] == "code-review"
    assert response.json()["reason"] == "collision"
    assert "Next action" not in response.json()["detail"]
    assert response.json()["remediation"]
    assert response.json()["retryable"] is True
    assert AgentRun.objects.count() == 0
    assert AgentTerminalSession.objects.count() == 0


def test_list_terminals_returns_active_sessions(client, monkeypatch):
    _no_background_reconcile(monkeypatch)

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


def test_list_terminals_excludes_sessions_owned_by_another_runtime(client, monkeypatch):
    _no_background_reconcile(monkeypatch)

    _insert_run("run-local")
    _insert_run("run-foreign")
    _insert_session(
        "run-local",
        task_id="task-1",
        created_at="2026-05-29T09:00:00",
        agent="codex",
    )
    _insert_session(
        "run-foreign",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="codex",
        runtime_namespace="packaged-runtime",
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == ["run-local"]


def test_list_terminals_serializes_only_immutable_session_fields(client, monkeypatch):
    _no_background_reconcile(monkeypatch)

    _insert_run("task-run")
    _insert_run("hidden-doc-run")
    _insert_session(
        "task-run",
        task_id="task-1",
        created_at="2026-05-29T09:00:00",
        agent="claude-code",
        doc_rel_path="spec/x/LLD.html",
    )
    _insert_session(
        "hidden-doc-run",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="codex",
        scope="docchat",
        doc_rel_path="spec/x/hidden.html",
    )

    rows = terminals_api.list_terminals("task-1")

    assert [item["agent_run_id"] for item in rows] == ["task-run"]
    row = rows[0]
    assert row["doc_rel_path"] == "spec/x/LLD.html"
    assert "tmux_session_name" not in row
    assert "scope" not in row
    assert "task_id" not in row
    assert "module_id" not in row
    assert "terminated_at" not in row


def test_list_scratch_terminals_returns_active_no_task_sessions(client, monkeypatch):
    """GET /api/terminals/scratch lists active sentinel-task sessions by module."""

    _no_background_reconcile(monkeypatch)

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
    assert "scope" not in rows[0]
    assert "task_id" not in rows[0]

    # Regression: the task-bound list never includes the scratch session.
    task_resp = client.get("/api/terminals", {"task_id": "task-1"})
    assert [r["agent_run_id"] for r in task_resp.json()] == ["task-run"]


def test_list_scratch_terminals_can_hydrate_all_project_modules(client, monkeypatch):
    _no_background_reconcile(monkeypatch)
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
    assert {row["agent_run_id"] for row in response.json()} == {
        "scratch-one",
        "scratch-two",
    }
    assert all("module_id" not in row for row in response.json())


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_resume_terminal_returns_new_and_old_ids(client, monkeypatch):
    async def fake_resume(agent_run_id: str) -> str:
        assert agent_run_id == "run-old"
        return "run-new"

    monkeypatch.setattr(terminals_api, "resume_provider_conversation", fake_resume)

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
            launch.ResumeUnavailable("unknown_run"),
            404,
            {"detail": "unknown_run", "code": "unknown_run"},
        ),
        (
            launch.ResumeUnavailable("run_still_active"),
            409,
            {"detail": "run_still_active", "code": "run_still_active"},
        ),
        (
            launch.ResumeUnavailable("no_provider_session_id"),
            409,
            {"detail": "no_provider_session_id", "code": "no_provider_session_id"},
        ),
        (
            launch.ResumeUnavailable("cwd_missing"),
            409,
            {"detail": "cwd_missing", "code": "cwd_missing"},
        ),
        (
            registry.ResumeUnsupported("claude"),
            409,
            {"detail": "resume_unsupported", "code": "resume_unsupported"},
        ),
        (
            launch.LaunchUnavailable("tmux failed"),
            500,
            {"detail": "tmux failed", "code": "launch_unavailable"},
        ),
        (
            launch.PromptDeliveryFailed(reason="readiness_timeout"),
            503,
            {
                "detail": "prompt_delivery_failed",
                "code": "prompt_delivery_failed",
                "reason": "readiness_timeout",
            },
        ),
        (
            registry.UnknownAgent("bogus"),
            409,
            {"detail": "unknown_agent", "code": "unknown_agent"},
        ),
    ],
)
@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_resume_terminal_maps_errors(client, monkeypatch, exc, status_code, payload):
    async def fake_resume(agent_run_id: str) -> str:
        raise exc

    monkeypatch.setattr(terminals_api, "resume_provider_conversation", fake_resume)

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
            "launch_state": None,
            "launch_model": None,
            "scope": "task",
            "provider_session_id": "sess-chain",
            "resumed_from": "chain-a",
        },
        {
            "agent_run_id": "plain-run",
            "agent": "claude-code",
            "status": "terminated",
            "started_at": "2026-05-29T10:00:00",
            "launch_state": None,
            "launch_model": None,
            "scope": "task",
            "provider_session_id": "sess-plain",
            "resumed_from": None,
        },
    ]


def test_list_resumable_terminals_carry_their_launch_snapshot():
    # A dormant chip names the phase its conversation began in, so the listing
    # carries the run's own launch snapshot rather than leaving the client to
    # find the run in a status snapshot it may have aged out of (#695). A run
    # that recorded none is reported as null, never as the work item's current
    # state.
    _insert_run(
        "captured",
        task_id="task-1",
        started_at="2026-05-29T12:30:00",
        ended_at="2026-05-29T13:00:00",
        provider_session_id="sess-captured",
        launch_state="Grill",
        launch_model="opus-5",
    )
    _insert_run(
        "unrecorded",
        task_id="task-1",
        ended_at="2026-05-29T12:00:00",
        provider_session_id="sess-unrecorded",
    )

    rows = terminals_api.list_resumable_terminals(
        task_id=fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id="task-1"
        )
    )

    snapshots = {
        row["agent_run_id"]: (row["launch_state"], row["launch_model"])
        for row in rows
    }
    assert snapshots == {
        "captured": ("Grill", "opus-5"),
        "unrecorded": (None, None),
    }


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


def test_list_resumable_module_runs_includes_plan_and_instant_runs(client):
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
    assert [row["agent_run_id"] for row in response.json()] == [
        "module-instant",
        "module-plan",
    ]
    # A scratch run's scope is the only durable source for its resume chip's
    # word, since a scratch launch records no launch state (#708).
    assert {row["agent_run_id"]: row["scope"] for row in response.json()} == {
        "module-instant": "instant",
        "module-plan": "plan",
    }


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


def test_delete_terminal_terminates_and_soft_deletes(
    client, monkeypatch, terminal_runtime
):
    _insert_run("run-delete")
    _insert_session(
        "run-delete",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )

    terminal_runtime.present.add("run-delete")

    response = client.delete("/api/terminals?agent_run_id=run-delete")

    assert response.status_code == 200
    assert response.json() == {"agent_run_id": "run-delete", "terminated": True}
    row = AgentTerminalSession.objects.get(agent_run_id="run-delete")
    assert row.terminated_at is not None
    assert terminal_runtime.terminated == ["run-delete"]


def test_self_terminate_ends_only_the_authorized_active_run(
    client, monkeypatch, terminal_runtime
):
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

    terminal_runtime.present.update(("run-caller", "run-other"))

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
    assert terminal_runtime.terminated == ["run-caller"]
    assert (
        AgentTerminalSession.objects.get(agent_run_id="run-other").terminated_at is None
    )


def test_self_terminate_is_idempotent_for_an_inactive_run(
    client, monkeypatch, terminal_runtime
):
    _insert_run("run-ended", ended_at="2026-05-29T10:30:00")
    _insert_session(
        "run-ended",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude",
        terminated_at="2026-05-29T10:30:00",
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
    assert terminal_runtime.terminated == ["run-ended"]


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
        terminals_api,
        "terminate_agent_run",
        lambda run_id: pytest.fail("unbound caller must not terminate a run"),
    )
    headers = {"HTTP_AUTHORIZATION": authorization} if authorization else {}

    response = client.post("/api/terminals/self-terminate", **headers)

    assert response.status_code == 401
    assert response.json() == {
        "detail": error,
        "code": "caller_run_unbound",
    }
    assert AgentRun.objects.get(id="run-safe").status == "running"


def test_self_terminate_rejects_a_valid_identity_for_an_unknown_run(
    client, monkeypatch
):
    monkeypatch.setattr(
        terminals_api,
        "terminate_agent_run",
        lambda run_id: pytest.fail("unknown run must not reach termination"),
    )

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-missing"),
    )

    assert response.status_code == 404
    assert response.json() == {
        "detail": "caller_run_unknown",
        "code": "caller_run_unknown",
    }


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
    terminated: list[str] = []
    monkeypatch.setattr(terminals_api, "terminate_agent_run", terminated.append)

    response = client.post(
        "/api/terminals/self-terminate",
        HTTP_AUTHORIZATION=issue_run_authorization("run-old"),
    )

    assert response.status_code == 200
    assert response.json()["already_terminated"] is True
    assert terminated == ["run-old"]
    assert AgentRun.objects.get(id="run-resumed").status == "running"
    assert (
        AgentTerminalSession.objects.get(agent_run_id="run-resumed").terminated_at
        is None
    )


def test_mcp_tool_crosses_studio_and_uses_terminal_authority(
    client, monkeypatch, terminal_runtime
):
    """The zero-arg MCP function reaches Studio and preserves termination effects."""

    import httpx
    import sys
    import types
    from pathlib import Path

    agent_root = Path(__file__).resolve().parents[4] / "surfaces" / "worktracker-agent"
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
    terminal_runtime.present.add("run-e2e")
    stopped_watches = []
    published = []
    monkeypatch.setattr(
        launch_module.documents_watch, "stop_watch", stopped_watches.append
    )
    monkeypatch.setattr(
        launch_module,
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


def test_shell_runs_are_absent_from_the_scratch_and_resumable_lists(
    client, monkeypatch
):
    """A shell run shares the scratch sentinel but not the scratch surfaces.

    Both exclusions are declared rather than inferred, so a shell run cannot
    surface as a Scratch workspace tab or consume a resume chip (#665).
    """

    _no_background_reconcile(monkeypatch)

    _insert_run("plan-run", task_id=SCRATCH_TASK_ID)
    _insert_run("shell-run", task_id=SCRATCH_TASK_ID)
    _insert_session(
        "plan-run",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-08-15T10:00:00",
        agent="claude-code",
        scope="plan",
    )
    _insert_session(
        "shell-run",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-08-15T11:00:00",
        agent=None,
        scope=SHELL_SCOPE,
    )
    AgentRun.objects.filter(id="shell-run").update(agent=None)

    rows = terminals_api.list_scratch_terminals("proj-1", "mod-1")
    assert [row["agent_run_id"] for row in rows] == ["plan-run"]

    # Even given the provider identity a resume would need, a shell run is not
    # offered: it has no conversation to continue.
    AgentRun.objects.filter(id="shell-run").update(
        ended_at="2026-08-15T12:00:00",
        status="terminated",
        provider_session_id="sess-shell",
    )
    resumable = terminals_api.list_resumable_terminals(
        project_id=fixture_uuid("proj-1"),
        module_id=fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id=None
        ),
    )
    assert "shell-run" not in [row["agent_run_id"] for row in resumable]


def _link_module_folder(tmp_config, sample_profile, path) -> str:
    """Point the selected profile's link for module `mod-1` at ``path``."""

    from apps.terminals.tests.conftest import write_profiles

    module_id = fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id=None
    )
    write_profiles(
        tmp_config,
        [
            {
                **sample_profile,
                "module_links": [{"module_id": module_id, "path": str(path)}],
            }
        ],
        recent=0,
    )
    return module_id


def test_module_shell_endpoints_create_and_list_a_module_scoped_shell(
    client, monkeypatch, tmp_path, tmp_config, sample_profile
):
    """POST/GET /api/terminals/shells own a module's login shells (#666)."""

    _no_background_reconcile_shells(monkeypatch)
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    module_id = _link_module_folder(tmp_config, sample_profile, module_folder)

    created = client.post(
        "/api/terminals/shells",
        data=json.dumps({"module_id": module_id}),
        content_type="application/json",
    )

    assert created.status_code == 200
    agent_run_id = created.json()["agent_run_id"]
    listed = client.get("/api/terminals/shells", {"module_id": module_id})
    assert listed.status_code == 200
    assert [row["agent_run_id"] for row in listed.json()] == [agent_run_id]

    # Ending a shell is the ordinary run termination, not a second operation.
    terminated = client.delete(
        f"/api/terminals?agent_run_id={agent_run_id}",
    )
    assert terminated.status_code == 200
    assert client.get("/api/terminals/shells", {"module_id": module_id}).json() == []


def test_module_shell_creation_is_refused_without_a_module_folder(
    client, monkeypatch, tmp_config, sample_profile
):
    _no_background_reconcile_shells(monkeypatch)
    module_id = _link_module_folder(tmp_config, sample_profile, "")

    refused = client.post(
        "/api/terminals/shells",
        data=json.dumps({"module_id": module_id}),
        content_type="application/json",
    )

    assert refused.status_code == 409
    assert refused.json()["code"] == "module_folder_unset"
    assert not AgentRun.objects.filter(scope=SHELL_SCOPE).exists()


def test_module_shell_listing_requires_a_module(client):
    response = client.get("/api/terminals/shells")

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "module_id_required"


def _no_background_reconcile_shells(monkeypatch):
    from apps.terminals import shell_api

    monkeypatch.setattr(shell_api, "schedule_terminal_reconciliation", lambda: False)
