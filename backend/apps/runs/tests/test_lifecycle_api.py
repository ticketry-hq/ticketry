"""Tests for the lifecycle ingress endpoint (#498/#507/#515).

Ported from ``web/backend/tests/test_lifecycle_events.py``:
- An event carrying ``provider_session_id`` is persisted on its run row.
- An event without it, or for an unknown run, is a safe 202 no-op.
- A recognized kind is reduced and stored as the run's latest state.
"""

from datetime import datetime, timedelta, timezone

import pytest
from django.test import AsyncClient, override_settings

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.terminals import launch as terminal_launch
from apps.terminals.authorization import issue_run_authorization
from apps.terminals.models import AgentTerminalSession
from worktracker.tests.factories import fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)

class HostAsyncClient(AsyncClient):
    async def get(self, path, *args, **kwargs):
        return await super().get(f"/api{path}", *args, **kwargs)

    async def post(self, path, *args, json=None, **kwargs):
        if json is not None:
            kwargs.update(data=json, content_type="application/json")
        return await super().post(f"/api{path}", *args, **kwargs)


client = HostAsyncClient()
PROJECT_ID = fixture_uuid("proj-1")
MODULE_1_ID = fixture_issue_id(
    project_id="proj-1", module_id="mod-1", task_id=None
)
MODULE_2_ID = fixture_issue_id(
    project_id="proj-1", module_id="mod-2", task_id=None
)


def _task_id(label: str) -> str:
    return fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id=label
    )


async def _seed_run(
    run_id: str,
    *,
    task_id: str | None = None,
    module_id: str = "mod-1",
    scope: str = "task",
) -> None:
    """Insert a minimal running agent run."""

    await dao.insert_agent_run(
        AgentRun(
            id=run_id,
            issue_id=fixture_issue_id(
                project_id="proj-1", module_id=module_id, task_id=task_id
            ),
            agent="codex",
            status="running",
            started_at="2026-06-02T10:00:00",
            scope=scope,
        )
    )
    await AgentTerminalSession.objects.acreate(
        agent_run_id=run_id,
        tmux_session_name=f"tmux-{run_id}",
        task_id=task_id or "scratch",
        module_id=module_id,
        project_id="proj-1",
        agent="codex",
        created_at="2026-06-02T10:00:00",
        runtime_namespace=terminal_launch.terminal_runtime.namespace,
        scope=scope,
    )


async def test_module_activity_endpoint_returns_scoped_map(monkeypatch) -> None:
    from datetime import datetime, timezone
    class MockDatetime:
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 6, 15, tzinfo=timezone.utc)
    monkeypatch.setattr("apps.runs.dao.activity.datetime", MockDatetime)

    # Scratch run (null task) under mod-2 must still rank its module (#598).
    await _seed_run("r1", module_id="mod-1")
    await _seed_run("r2", task_id=None, module_id="mod-2")

    resp = await client.get(f"/runs/module-activity?project_id={PROJECT_ID}")

    assert resp.status_code == 200
    body = resp.json()
    assert body[MODULE_1_ID] == "2026-06-02T10:00:00"
    assert body[MODULE_2_ID] == "2026-06-02T10:00:00"


async def test_module_activity_window_param_excludes_old_runs(monkeypatch) -> None:
    from datetime import datetime, timezone
    class MockDatetime:
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 6, 15, tzinfo=timezone.utc)
    monkeypatch.setattr("apps.runs.dao.activity.datetime", MockDatetime)

    await _seed_run("r1", module_id="mod-1")  # started 2026-06-02, well past

    resp = await client.get(
        f"/runs/module-activity?project_id={PROJECT_ID}&window_days=1"
    )

    assert resp.status_code == 200
    assert resp.json() == {}


def _event(run_id: str, **extra) -> dict:
    """Build a default session_start event payload."""

    payload = {
        "agent_run_id": run_id,
        "agent": "codex",
        "kind": "session_start",
        "ts": "2026-06-02T10:00:01+00:00",
    }
    payload.update(extra)
    return payload


async def _state(run_id: str) -> str | None:
    """Read a run's stored lifecycle state, if any."""

    run = await AgentRun.objects.filter(id=run_id).afirst()
    return run.lifecycle_state if run else None


async def _provider_session_id(run_id: str) -> str | None:
    """Read a run's stored provider session id, if any."""

    run = await AgentRun.objects.filter(id=run_id).afirst()
    return run.provider_session_id if run else None


async def test_provider_session_id_is_persisted() -> None:
    await _seed_run("run-1")

    session_uuid = "11111111-2222-3333-4444-555555555555"
    response = await client.post(
        "/lifecycle/events", json=_event("run-1", provider_session_id=session_uuid)
    )

    assert response.status_code == 202
    # Stored separately from the run id (the agent_run_id).
    assert await _provider_session_id("run-1") == session_uuid


async def test_event_without_provider_session_id_is_a_no_op() -> None:
    await _seed_run("run-2")

    response = await client.post("/lifecycle/events", json=_event("run-2"))

    assert response.status_code == 202
    assert await _provider_session_id("run-2") is None


async def test_unknown_run_id_is_acknowledged() -> None:
    response = await client.post(
        "/lifecycle/events", json=_event("missing", provider_session_id="abc")
    )

    # An unknown run is a safe no-op: still accepted, nothing persisted.
    assert response.status_code == 202


async def test_response_body_shape() -> None:
    await _seed_run("run-body")

    response = await client.post("/lifecycle/events", json=_event("run-body"))

    body = response.json()
    assert set(body) == {"accepted", "received_at"}
    assert body["accepted"]["agent_run_id"] == "run-body"
    assert body["accepted"]["source"] == "hook"


async def test_kind_is_reduced_and_persisted_as_lifecycle_state() -> None:
    await _seed_run("run-life")

    # awaiting_input reduces to needs_input (agrees with
        # studio/src/coding/lib/lifecycle.ts).
    response = await client.post(
        "/lifecycle/events", json=_event("run-life", kind="awaiting_input")
    )

    assert response.status_code == 202
    assert await _state("run-life") == "needs_input"

    stored = await AgentRun.objects.aget(id="run-life")
    assert stored.lifecycle_updated_at == "2026-06-02T10:00:01+00:00"


async def test_permission_required_is_persisted_as_a_distinct_state() -> None:
    await _seed_run("run-permission")

    response = await client.post(
        "/lifecycle/events",
        json=_event("run-permission", kind="permission_required"),
    )

    assert response.status_code == 202
    assert await _state("run-permission") == "permission_required"


async def test_latest_event_overwrites_lifecycle_state() -> None:
    await _seed_run("run-seq")

    await client.post("/lifecycle/events", json=_event("run-seq", kind="turn_start"))
    await client.post(
        "/lifecycle/events",
        json=_event(
            "run-seq", kind="turn_complete", ts="2026-06-02T10:00:02+00:00"
        ),
    )

    # The column holds the most recent transition, not the first.
    assert await _state("run-seq") == "turn_complete"


async def test_non_attention_kind_still_persists_its_state() -> None:
    await _seed_run("run-quiet")

    await client.post("/lifecycle/events", json=_event("run-quiet", kind="idle"))

    # idle maps to quiet: not attention-worthy, but still the run's latest state.
    assert await _state("run-quiet") == "quiet"


# --- run-scoped ingress authorization ----------------------------------------


async def test_ingest_requires_run_authorization_when_auth_enabled() -> None:
    await _seed_run("run-auth-missing")

    with override_settings(WORKTRACKER_DISABLE_AUTH=False):
        response = await client.post(
            "/lifecycle/events", json=_event("run-auth-missing")
        )

    assert response.status_code == 401
    assert await _state("run-auth-missing") is None


async def test_ingest_rejects_token_bound_to_another_run() -> None:
    await _seed_run("run-auth-other")

    foreign = issue_run_authorization("some-other-run")
    with override_settings(WORKTRACKER_DISABLE_AUTH=False):
        response = await client.post(
            "/lifecycle/events",
            json=_event("run-auth-other"),
            headers={"Authorization": foreign},
        )

    assert response.status_code == 401
    assert await _state("run-auth-other") is None


async def test_ingest_accepts_matching_run_authorization() -> None:
    await _seed_run("run-auth-ok")

    credential = issue_run_authorization("run-auth-ok")
    with override_settings(WORKTRACKER_DISABLE_AUTH=False):
        response = await client.post(
            "/lifecycle/events",
            json=_event("run-auth-ok"),
            headers={"Authorization": credential},
        )

    assert response.status_code == 202
    assert await _state("run-auth-ok") == "starting"


# --- GET /runs/agent-status (T962-S1) ---------------------------------------


async def _seed_status_run(
    run_id: str,
    *,
    task_id: str,
    project_id: str = "proj-1",
    started_at: str,
    lifecycle_state: str | None,
    lifecycle_updated_at: str | None = None,
    status: str = "running",
    ended_at: str | None = None,
    scope: str = "task",
    runtime_namespace: str | None = None,
    persist_terminal: bool = True,
    launch_state: str | None = None,
    launch_model: str | None = None,
) -> None:
    await dao.insert_agent_run(
        AgentRun(
            id=run_id,
            issue_id=fixture_issue_id(
                project_id=project_id, module_id="mod-1", task_id=task_id
            ),
            agent="codex",
            status=status,
            started_at=started_at,
            ended_at=ended_at,
            lifecycle_state=lifecycle_state,
            lifecycle_updated_at=lifecycle_updated_at,
            launch_state=launch_state,
            launch_model=launch_model,
            scope=scope,
        )
    )
    if persist_terminal:
        await AgentTerminalSession.objects.acreate(
            agent_run_id=run_id,
            tmux_session_name=f"tmux-{run_id}",
            task_id=task_id or "scratch",
            module_id="mod-1",
            project_id=project_id,
            agent="codex",
            created_at=started_at,
            runtime_namespace=(
                runtime_namespace or terminal_launch.terminal_runtime.namespace
            ),
            scope=scope,
        )


async def test_agent_status_returns_snapshot_body_and_all_run_records(
    monkeypatch,
) -> None:
    fixed = datetime(2026, 7, 12, 15, 30, tzinfo=timezone.utc)

    class MockDatetime:
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr("apps.runs.api.datetime", MockDatetime)
    await _seed_status_run(
        "with-event", task_id="t1", started_at="2026-07-12T14:00:00+00:00",
        lifecycle_state="needs_input",
        lifecycle_updated_at="2026-07-12T15:00:00+00:00",
        launch_state="Grill",
        launch_model="gpt-5-codex",
    )
    await _seed_status_run(
        "pre-event", task_id="t2", started_at="2026-07-12T15:05:00+00:00",
        lifecycle_state=None,
        scope="plan",
    )

    response = await client.get(f"/runs/agent-status?project_id={PROJECT_ID}")

    assert response.status_code == 200
    assert response.json() == {
        "scope": {"project_id": PROJECT_ID, "task_id": None},
        "runs": [
            {
                "agent_run_id": "pre-event",
                "project_id": PROJECT_ID,
                "task_id": _task_id("t2"),
                "module_id": MODULE_1_ID,
                "agent": "codex",
                "scope": "plan",
                # A run that recorded no launch snapshots projects them as
                # null; the snapshot never falls back to the work item's
                # current state or a provider default (#693).
                "launch_state": None,
                "launch_model": None,
                "started_at": "2026-07-12T15:05:00+00:00",
                "state": "unknown",
                "updated_at": "2026-07-12T15:05:00+00:00",
                # No hosted command has reported a result on a live run.
                "exit_code": None,
                # Both axes travel in the snapshot. This session has produced no
                # output and reports no provider state, so it falls back to its
                # creation-time inactivity origin and projects stalled long
                # after (#661).
                "output_sequence": 0,
                "last_output_at": "2026-07-12T15:05:00+00:00",
                "effective_state": "stalled",
            },
            {
                "agent_run_id": "with-event",
                "project_id": PROJECT_ID,
                "task_id": _task_id("t1"),
                "module_id": MODULE_1_ID,
                "agent": "codex",
                "scope": "task",
                # A run that recorded them projects exactly what it captured
                # at launch.
                "launch_state": "Grill",
                "launch_model": "gpt-5-codex",
                "started_at": "2026-07-12T14:00:00+00:00",
                "state": "needs_input",
                "updated_at": "2026-07-12T15:00:00+00:00",
                "exit_code": None,
                "output_sequence": 0,
                "last_output_at": "2026-07-12T14:00:00+00:00",
                # A run waiting on the person keeps that signal however long it
                # waits: it already explains its own silence (#681).
                "effective_state": "needs_input",
            },
        ],
        "automation_attempts": [],
        "at": "2026-07-12T15:30:00+00:00",
    }


async def test_agent_status_projects_the_inactivity_boundary_at_read_time() -> None:
    """#661: the snapshot projects both axes without rewriting either."""

    await _seed_status_run(
        "silent-run",
        task_id="t1",
        started_at="2026-07-12T15:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-07-12T15:00:00+00:00",
    )
    observed = datetime(2026, 7, 12, 15, 0, tzinfo=timezone.utc)

    just_inside = await dao.agent_status_records(
        PROJECT_ID,
        runtime_namespace=terminal_launch.terminal_runtime.namespace,
        now=observed + timedelta(seconds=59),
    )
    at_boundary = await dao.agent_status_records(
        PROJECT_ID,
        runtime_namespace=terminal_launch.terminal_runtime.namespace,
        now=observed + timedelta(seconds=60),
    )

    assert [record.effective_state for record in just_inside] == ["working"]
    assert [record.effective_state for record in at_boundary] == ["stalled"]
    # The persisted provider lifecycle record is untouched by either read.
    assert [record.state for record in at_boundary] == ["working"]
    run = await AgentRun.objects.aget(id="silent-run")
    assert run.lifecycle_state == "working"


async def test_agent_status_ended_run_is_an_exited_tombstone(monkeypatch) -> None:
    """#978: an ended run must snapshot as `exited` even if its last recorded
    lifecycle event said `working` (or it recorded none at all)."""

    class MockDatetime:
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 7, 12, 15, 30, tzinfo=timezone.utc)

    monkeypatch.setattr("apps.runs.dao.activity.datetime", MockDatetime)

    await _seed_status_run(
        "ended-working", task_id="t1",
        started_at="2026-07-12T14:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-07-12T14:30:00+00:00",
        status="completed",
        ended_at="2026-07-12T15:00:00+00:00",
    )
    await _seed_status_run(
        "ended-silent", task_id="t2",
        started_at="2026-07-12T14:10:00+00:00",
        lifecycle_state=None,
        status="completed",
        ended_at="2026-07-12T14:20:00+00:00",
    )

    response = await client.get(f"/runs/agent-status?project_id={PROJECT_ID}")

    assert response.status_code == 200
    runs = {run["agent_run_id"]: run for run in response.json()["runs"]}
    assert runs["ended-working"]["state"] == "exited"
    assert runs["ended-working"]["updated_at"] == "2026-07-12T15:00:00+00:00"
    assert runs["ended-silent"]["state"] == "exited"
    assert runs["ended-silent"]["updated_at"] == "2026-07-12T14:20:00+00:00"


async def test_agent_status_omits_active_run_owned_by_another_runtime() -> None:
    """A foreign runtime's unresolved row must not create a local live badge."""

    now = datetime.now(timezone.utc).isoformat()
    await _seed_status_run(
        "owned",
        task_id="t1",
        started_at=now,
        lifecycle_state="working",
        lifecycle_updated_at=now,
    )
    await _seed_status_run(
        "foreign-ghost",
        task_id="t2",
        started_at=now,
        lifecycle_state="working",
        lifecycle_updated_at=now,
        runtime_namespace="another-runtime",
    )

    response = await client.get(f"/runs/agent-status?project_id={PROJECT_ID}")

    assert response.status_code == 200
    assert [run["agent_run_id"] for run in response.json()["runs"]] == ["owned"]


async def test_agent_status_omits_active_run_without_terminal_session() -> None:
    """An old partial row without a terminal cannot be a live local run."""

    now = datetime.now(timezone.utc).isoformat()
    await _seed_status_run(
        "terminal-less-ghost",
        task_id="t1",
        started_at=now,
        lifecycle_state="turn_complete",
        lifecycle_updated_at=now,
        persist_terminal=False,
    )

    response = await client.get(f"/runs/agent-status?project_id={PROJECT_ID}")

    assert response.status_code == 200
    assert response.json()["runs"] == []


async def test_agent_status_optional_task_filter_is_authoritative_scope() -> None:
    now = datetime.now(timezone.utc).isoformat()
    await _seed_status_run(
        "wanted", task_id="t1", started_at=now, lifecycle_state="working",
        lifecycle_updated_at=now,
    )
    await _seed_status_run(
        "other", task_id="t2", started_at=now, lifecycle_state="quiet",
        lifecycle_updated_at=now,
    )

    response = await client.get(
        f"/runs/agent-status?project_id={PROJECT_ID}&task_id={_task_id('t1')}"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == {"project_id": PROJECT_ID, "task_id": _task_id("t1")}
    assert [run["agent_run_id"] for run in body["runs"]] == ["wanted"]


async def test_agent_status_omits_old_ended_runs_but_keeps_old_active_runs(
    monkeypatch,
) -> None:
    fixed = datetime(2026, 7, 12, 15, 30, tzinfo=timezone.utc)

    class MockDatetime:
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr("apps.runs.dao.activity.datetime", MockDatetime)
    await _seed_status_run(
        "old-ended", task_id="t1", started_at="2026-01-01T00:00:00+00:00",
        lifecycle_state="working", status="completed",
        ended_at="2026-01-02T00:00:00+00:00",
    )
    await _seed_status_run(
        "old-active", task_id="t2", started_at="2026-01-01T00:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-01-01T01:00:00+00:00",
    )
    await _seed_status_run(
        "recently-ended", task_id="t3", started_at="2026-01-01T00:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-01-01T01:00:00+00:00",
        status="completed", ended_at="2026-07-12T15:00:00+00:00",
    )

    response = await client.get(f"/runs/agent-status?project_id={PROJECT_ID}")

    assert [run["agent_run_id"] for run in response.json()["runs"]] == [
        "recently-ended", "old-active",
    ]


async def test_older_lifecycle_event_does_not_regress_snapshot_state() -> None:
    await _seed_run("ordered", task_id="t1")
    await client.post(
        "/lifecycle/events",
        json=_event(
            "ordered", kind="turn_complete", ts="2026-07-12T15:00:00Z"
        ),
    )
    await client.post(
        "/lifecycle/events",
        json=_event("ordered", kind="turn_start", ts="2026-07-12T14:00:00Z"),
    )

    response = await client.get(
        f"/runs/agent-status?project_id={PROJECT_ID}&task_id={_task_id('t1')}"
    )

    assert response.json()["runs"][0]["state"] == "turn_complete"
    assert response.json()["runs"][0]["updated_at"] == (
        "2026-07-12T15:00:00+00:00"
    )
