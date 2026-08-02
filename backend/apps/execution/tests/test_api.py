from __future__ import annotations

import asyncio
import uuid

import pytest
from django.test import Client, override_settings

from apps.execution import driver
from apps.terminals.launch_configuration import resolve_task_launch_configuration
from worktracker.models import (
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    State,
    Workspace,
)


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def clean_registry():
    driver.clear_registry()
    yield
    driver.clear_registry()


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )


@pytest.fixture
def module(project):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="Module",
        sequence_id=1,
    )


@pytest.fixture
def backlog(project):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )


@pytest.fixture
def todo(project):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )


@pytest.fixture
def done(project):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )


def task(project, module, state, sequence_id=2):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Story",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    LaunchBinding.objects.get_or_create(
        issue_type=issue_type,
        state=state,
        defaults={"subtree_run_enabled": True},
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=module,
        state=state,
        name="Task",
        sequence_id=sequence_id,
        description="Raw idea",
    )


async def successful_spawn(**kwargs):
    successful_spawn.calls.append(kwargs)
    return "run-1"


successful_spawn.calls = []


def _child(project, parent, state, sequence_id, name="Child"):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        parent=parent,
        state=state,
        name=name,
        sequence_id=sequence_id,
    )


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize("binding_exists", [False, True])
def test_execute_graph_refuses_root_until_subtree_run_is_enabled(
    client, project, module, todo, monkeypatch, binding_exists
):
    root = task(project, module, todo, sequence_id=2)
    _child(project, root, todo, 3)
    binding = LaunchBinding.objects.get(
        issue_type=root.issue_type,
        state=root.state,
    )
    if binding_exists:
        binding.subtree_run_enabled = False
        binding.save(update_fields=["subtree_run_enabled"])
    else:
        binding.delete()
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    refused = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert refused.status_code == 422
    assert refused.json()["error"] == "subtree_run_not_enabled"
    assert successful_spawn.calls == []

    LaunchBinding.objects.update_or_create(
        issue_type=root.issue_type,
        state=root.state,
        defaults={"subtree_run_enabled": True},
    )
    accepted = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert accepted.status_code == 201
    assert accepted.json()["root_id"] == str(root.id)


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_allows_configured_nested_root_without_checking_descendants(
    client, project, module, todo, monkeypatch
):
    top = task(project, module, todo, sequence_id=2)
    nested = _child(project, top, todo, 3, name="Nested root")
    _child(project, nested, todo, 4, name="Unconfigured descendant")
    nested.issue_type = top.issue_type
    nested.save(update_fields=["issue_type"])
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{nested.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["root_id"] == str(nested.id)


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_disabled_root_can_still_be_read_reset_and_generate_leaf_llds(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo, sequence_id=2)
    failed = _child(project, root, todo, 3, name="Failed")

    async def failing_spawn(**kwargs):
        raise RuntimeError("launch failed")

    monkeypatch.setattr(driver, "spawn_run", failing_spawn)
    launched = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )
    assert launched.status_code == 201
    assert launched.json()["nodes"][0]["status"] == "failed"

    LaunchBinding.objects.filter(
        issue_type=root.issue_type,
        state=root.state,
    ).update(subtree_run_enabled=False)
    fresh_leaf = _child(project, root, todo, 4, name="Fresh leaf")
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    graph = client.get(f"/api/work-items/{root.id}/execute-graph")
    dependency_graph = client.get(f"/api/work-items/{root.id}/dependency-graph")
    reset = client.delete(f"/api/work-items/{root.id}/execute-graph")
    leaf_llds = client.post(
        f"/api/work-items/{root.id}/generate-leaf-llds",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert graph.status_code == 200
    assert dependency_graph.status_code == 200
    assert reset.status_code == 200
    assert reset.json()["nodes"][0]["task_id"] == str(failed.id)
    assert reset.json()["nodes"][0]["status"] == "idle"
    assert leaf_llds.status_code == 201
    assert str(fresh_leaf.id) in {
        run["task_id"] for run in leaf_llds.json()["runs"]
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_returns_factual_subtree_before_any_run(
    client, project, module, todo, done, monkeypatch
):
    from apps.execution.models import EngineRun, GraphRun

    root = task(project, module, todo, sequence_id=2)
    blocker = _child(project, root, done, 3, name="Blocker")
    dependent = _child(project, root, todo, 4, name="Dependent")
    nested = _child(project, dependent, todo, 5, name="Nested")
    external = task(project, module, todo, sequence_id=6)
    dependent.blocked_by.add(blocker, external)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.get(f"/api/work-items/{root.id}/dependency-graph")

    assert response.status_code == 200
    assert response.json() == {
        "root_id": str(root.id),
        "nodes": [
            {
                "id": str(root.id),
                "state": "Todo",
                "parent_id": str(module.id),
                "blocked_by": [],
            },
            {
                "id": str(blocker.id),
                "state": "Done",
                "parent_id": str(root.id),
                "blocked_by": [],
            },
            {
                "id": str(dependent.id),
                "state": "Todo",
                "parent_id": str(root.id),
                "blocked_by": [str(blocker.id)],
            },
            {
                "id": str(nested.id),
                "state": "Todo",
                "parent_id": str(dependent.id),
                "blocked_by": [],
            },
        ],
    }
    assert GraphRun.objects.count() == 0
    assert EngineRun.objects.count() == 0
    assert successful_spawn.calls == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_returns_single_node_for_leaf(
    client, project, module, todo
):
    root = task(project, module, todo, sequence_id=2)

    response = client.get(f"/api/work-items/{root.id}/dependency-graph")

    assert response.status_code == 200
    assert response.json() == {
        "root_id": str(root.id),
        "nodes": [
            {
                "id": str(root.id),
                "state": "Todo",
                "parent_id": str(module.id),
                "blocked_by": [],
            }
        ],
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_excludes_archived_descendant_branches(
    client, project, module, todo
):
    root = task(project, module, todo, sequence_id=2)
    visible = _child(project, root, todo, 3, name="Visible")
    archived = _child(project, root, todo, 4, name="Archived")
    archived.is_archived = True
    archived.save(update_fields=["is_archived"])
    _child(project, archived, todo, 5, name="Hidden grandchild")

    response = client.get(f"/api/work-items/{root.id}/dependency-graph")

    assert response.status_code == 200
    assert [node["id"] for node in response.json()["nodes"]] == [
        str(root.id),
        str(visible.id),
    ]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_returns_not_found_for_unknown_or_archived_root(
    client, project, module, todo
):
    archived = task(project, module, todo, sequence_id=2)
    archived.is_archived = True
    archived.save(update_fields=["is_archived"])

    for root_id in (uuid.uuid4(), archived.id):
        response = client.get(f"/api/work-items/{root_id}/dependency-graph")

        assert response.status_code == 404
        assert response.json()["error"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_launches_ready_set_and_returns_201(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["root_id"] == str(root.id)
    statuses = {node["task_id"]: node["status"] for node in body["nodes"]}
    assert statuses[str(a.id)] == "running"
    assert statuses[str(b.id)] == "idle"
    assert [call["task_id"] for call in successful_spawn.calls] == [str(a.id)]
    assert successful_spawn.calls[0]["agent"] == "codex"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_omits_provider_override(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo, sequence_id=2)
    _child(project, root, todo, 3, name="A")
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["agent"] is None
    assert successful_spawn.calls[0]["agent"] is None


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_missing_task_returns_404(client, monkeypatch):
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{uuid.uuid4()}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 404
    assert response.json()["error"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_empty_subtree_returns_422(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["error"] == "graph_empty"
    assert successful_spawn.calls == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_execute_graph_returns_state_after_launch(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    _child(project, root, todo, 3, name="A")
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )
    response = client.get(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 200
    assert response.json()["root_id"] == str(root.id)


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_execute_graph_unregistered_returns_404(client, project, module, todo):
    root = task(project, module, todo, sequence_id=2)

    response = client.get(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 404
    assert response.json()["error"] == "graph_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_persists_header_and_node_rows(client, project, module, todo, monkeypatch):
    from apps.execution.models import EngineRun, GraphRun

    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    header = GraphRun.objects.get(pk=root.id)
    assert str(header.agent) == "codex"
    assert str(header.project_id) == str(project.id)
    assert str(header.module_id) == str(module.id)
    # The running node gets an implement-phase EngineRun row; the still-idle,
    # blocked node does not (absent → rebuilds to idle).
    row_a = EngineRun.objects.get(pk=a.id)
    assert (row_a.phase, row_a.status, row_a.agent_run_id) == ("implement", "running", "run-1")
    assert not EngineRun.objects.filter(pk=b.id).exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_execute_graph_rebuilds_after_registry_clear(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )
    # A's spawn returned "run-1"; make its AgentRun live so re-seed reports it
    # as cleanly running (not a stalled memory).
    from apps.runs.models import AgentRun

    AgentRun.objects.create(
        id="run-1",
        project_id=str(project.id),
        module_id=str(module.id),
        task_id=str(a.id),
        agent="codex",
        status="running",
        started_at="2026-07-02T00:00:00Z",
    )

    # Simulate an ASGI restart: only the in-memory graph cache is gone.
    driver._graph_registry.clear()

    response = client.get(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 200
    body = response.json()
    assert body["root_id"] == str(root.id)
    assert body["agent"] == "codex"
    nodes = {node["task_id"]: node for node in body["nodes"]}
    assert nodes[str(a.id)]["status"] == "running"
    assert nodes[str(a.id)]["agent_run_id"] == "run-1"
    assert nodes[str(b.id)]["status"] == "idle"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_execute_graph_rebuilds_failed_node_after_restart(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    successful_spawn.calls.clear()

    async def failing_spawn(**kwargs):
        raise RuntimeError("TMUX error")

    monkeypatch.setattr(driver, "spawn_run", failing_spawn)

    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    # Failed status is the case that only survives via the durable EngineRun row
    # (it cannot be re-derived from the tracker or a live AgentRun).
    driver._graph_registry.clear()

    response = client.get(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 200
    node = response.json()["nodes"][0]
    assert node["task_id"] == str(a.id)
    assert node["status"] == "failed"
    assert "TMUX error" in node["error"]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_execute_graph_rearms_failed_branch_across_restart(
    client, project, module, todo, done, monkeypatch
):
    root = task(project, module, todo, sequence_id=2)
    failed = _child(project, root, todo, 3, name="Failed")
    halted = _child(project, root, todo, 4, name="Halted")
    halted.blocked_by.add(failed)
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    failed.issue_type = issue_type
    halted.issue_type = issue_type
    Issue.objects.bulk_update([failed, halted], ["issue_type"])
    binding = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=todo,
        prompt="Implement this work item",
        agent=None,
    )
    spawn_calls = []

    async def policy_enforcing_spawn(**kwargs):
        spawn_calls.append(kwargs)
        configuration = await asyncio.to_thread(
            resolve_task_launch_configuration,
            kwargs["task_id"],
            agent_override=kwargs["agent"],
        )
        return f"run-{configuration.agent}-{len(spawn_calls)}"

    monkeypatch.setattr(driver, "spawn_run", policy_enforcing_spawn)
    first = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={},
        content_type="application/json",
    )
    assert first.status_code == 201
    assert {node["task_id"]: node["status"] for node in first.json()["nodes"]} == {
        str(failed.id): "failed",
        str(halted.id): "halted",
    }
    assert next(
        node for node in first.json()["nodes"] if node["task_id"] == str(failed.id)
    )["error"] == "agent_not_configured"

    reset = client.delete(f"/api/work-items/{root.id}/execute-graph")

    assert reset.status_code == 200
    assert {node["task_id"]: node["status"] for node in reset.json()["nodes"]} == {
        str(failed.id): "idle",
        str(halted.id): "idle",
    }
    assert len(spawn_calls) == 1

    # Publishing workflow settings ultimately replaces this active binding;
    # update that same policy record here so the execution seam proves launch
    # resolves the corrected current-state provider rather than stale graph data.
    binding.agent = "codex"
    binding.save(update_fields=["agent", "updated_at"])

    repeated_reset = client.delete(f"/api/work-items/{root.id}/execute-graph")
    assert repeated_reset.status_code == 200
    assert repeated_reset.json() == reset.json()
    assert len(spawn_calls) == 1

    # Simulate an ASGI restart between reset and the normal execute retry.
    driver._graph_registry.clear()

    retried = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={},
        content_type="application/json",
    )

    assert retried.status_code == 201
    statuses = {
        node["task_id"]: node["status"] for node in retried.json()["nodes"]
    }
    assert statuses[str(failed.id)] == "running"
    assert statuses[str(halted.id)] == "idle"
    assert next(
        node
        for node in retried.json()["nodes"]
        if node["task_id"] == str(failed.id)
    )["agent_run_id"] == "run-codex-2"
    assert [call["task_id"] for call in spawn_calls] == [
        str(failed.id),
        str(failed.id),
    ]
    assert retried.json()["agent"] is None

    failed.state = done
    failed.save(update_fields=["state"])
    after_first_completion = client.get(
        f"/api/work-items/{root.id}/execute-graph"
    ).json()
    statuses = {
        node["task_id"]: node["status"]
        for node in after_first_completion["nodes"]
    }
    assert statuses == {str(failed.id): "done", str(halted.id): "running"}
    assert next(
        node
        for node in after_first_completion["nodes"]
        if node["task_id"] == str(halted.id)
    )["agent_run_id"] == "run-codex-3"

    halted.state = done
    halted.save(update_fields=["state"])
    drained = client.get(f"/api/work-items/{root.id}/execute-graph").json()
    assert {node["task_id"]: node["status"] for node in drained["nodes"]} == {
        str(failed.id): "done",
        str(halted.id): "done",
    }
    assert [call["task_id"] for call in spawn_calls] == [
        str(failed.id),
        str(failed.id),
        str(halted.id),
    ]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_execute_graph_without_header_returns_graph_not_found(
    client, project, module, todo
):
    root = task(project, module, todo, sequence_id=2)

    response = client.delete(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 404
    assert response.json()["error"] == "graph_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_execute_graph_changes_only_failed_and_halted_implement_facts(
    client, project, module, todo, done, monkeypatch
):
    from apps.execution.models import EngineRun, GraphRun

    root = task(project, module, todo, sequence_id=2)
    failed = _child(project, root, todo, 3, name="Failed")
    halted = _child(project, root, todo, 4, name="Halted")
    completed = _child(project, root, done, 5, name="Done")
    running = _child(project, root, todo, 6, name="Running")
    planning = _child(project, root, todo, 7, name="Planning")
    halted.blocked_by.add(failed)
    planning.blocked_by.add(running)
    spawn_calls = []

    async def mixed_spawn(**kwargs):
        spawn_calls.append(kwargs)
        if kwargs["task_id"] == str(failed.id):
            raise RuntimeError("agent_not_configured")
        return "run-running"

    monkeypatch.setattr(driver, "spawn_run", mixed_spawn)
    launched = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )
    assert launched.status_code == 201

    EngineRun.objects.create(
        task=planning,
        project=project,
        module=module,
        agent="claude",
        phase="lld",
        status="failed",
        error="planning failure",
    )
    header_before = GraphRun.objects.filter(pk=root.id).values().get()
    done_before = EngineRun.objects.filter(pk=completed.id).values().get()
    running_before = EngineRun.objects.filter(pk=running.id).values().get()
    planning_before = EngineRun.objects.filter(pk=planning.id).values().get()
    visible_state_before = list(
        Issue.objects.filter(
            pk__in=[root.id, failed.id, halted.id, completed.id, running.id, planning.id]
        )
        .order_by("id")
        .values_list("id", "state_id")
    )
    halted_blockers_before = list(halted.blocked_by.values_list("id", flat=True))
    planning_blockers_before = list(planning.blocked_by.values_list("id", flat=True))

    response = client.delete(f"/api/work-items/{root.id}/execute-graph")

    assert response.status_code == 200
    assert not EngineRun.objects.filter(pk=failed.id).exists()
    assert not EngineRun.objects.filter(pk=halted.id).exists()
    assert GraphRun.objects.filter(pk=root.id).values().get() == header_before
    assert EngineRun.objects.filter(pk=completed.id).values().get() == done_before
    assert EngineRun.objects.filter(pk=running.id).values().get() == running_before
    assert EngineRun.objects.filter(pk=planning.id).values().get() == planning_before
    assert list(
        Issue.objects.filter(
            pk__in=[root.id, failed.id, halted.id, completed.id, running.id, planning.id]
        )
        .order_by("id")
        .values_list("id", "state_id")
    ) == visible_state_before
    assert list(halted.blocked_by.values_list("id", flat=True)) == halted_blockers_before
    assert list(planning.blocked_by.values_list("id", flat=True)) == planning_blockers_before
    assert [call["task_id"] for call in spawn_calls] == [
        str(failed.id),
        str(running.id),
    ]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_seam_event_after_reset_cannot_resurrect_cleared_failure(
    client, project, module, todo, done, monkeypatch
):
    root = task(project, module, todo, sequence_id=2)
    failed = _child(project, root, todo, 3, name="Failed")
    halted = _child(project, root, todo, 4, name="Halted")
    completing = _child(project, root, todo, 5, name="Completing")
    halted.blocked_by.add(failed)
    spawn_calls = []

    async def initial_spawn(**kwargs):
        spawn_calls.append(kwargs)
        if kwargs["task_id"] == str(failed.id):
            raise RuntimeError("agent_not_configured")
        return "run-completing"

    monkeypatch.setattr(driver, "spawn_run", initial_spawn)
    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )
    reset = client.delete(f"/api/work-items/{root.id}/execute-graph")
    assert reset.status_code == 200

    async def retry_spawn(**kwargs):
        spawn_calls.append(kwargs)
        return "run-retry"

    monkeypatch.setattr(driver, "spawn_run", retry_spawn)
    completing.state = done
    completing.save(update_fields=["state"])

    response = client.get(f"/api/work-items/{root.id}/execute-graph")
    statuses = {node["task_id"]: node["status"] for node in response.json()["nodes"]}
    assert statuses[str(failed.id)] == "running"
    assert statuses[str(halted.id)] == "idle"
    assert statuses[str(completing.id)] == "done"
    assert [call["task_id"] for call in spawn_calls] == [
        str(failed.id),
        str(completing.id),
        str(failed.id),
    ]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_reinvoke_does_not_relaunch_running_node(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    def _post():
        return client.post(
            f"/api/work-items/{root.id}/execute-graph",
            data={"agent": "codex"},
            content_type="application/json",
        )

    _post()
    # Simulate restart, then re-invoke: A is still running (durable), B still
    # blocked. Nothing new is ready, so no fresh spawn.
    driver._graph_registry.clear()
    second = _post()

    assert second.status_code == 201
    statuses = {node["task_id"]: node["status"] for node in second.json()["nodes"]}
    assert statuses[str(a.id)] == "running"
    assert statuses[str(b.id)] == "idle"
    assert [call["task_id"] for call in successful_spawn.calls] == [str(a.id)]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_launches_newly_ready_after_blocker_completes(client, project, module, todo, done, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    def _post():
        return client.post(
            f"/api/work-items/{root.id}/execute-graph",
            data={"agent": "codex"},
            content_type="application/json",
        )

    _post()  # launches A only
    # Complete A in the tracker; re-seed reports it done, opening B.
    a.state = done
    a.save(update_fields=["state"])
    driver._graph_registry.clear()
    second = _post()

    statuses = {node["task_id"]: node["status"] for node in second.json()["nodes"]}
    assert statuses[str(a.id)] == "done"
    assert statuses[str(b.id)] == "running"
    assert [call["task_id"] for call in successful_spawn.calls] == [str(a.id), str(b.id)]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_edges_derived_from_blocked_by_on_read(client, project, module, todo, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={"agent": "codex"},
        content_type="application/json",
    )

    # Edges are never stored — they rebuild from live blocked_by on every read.
    assert driver.get_graph(str(root.id)).edges == frozenset({(str(a.id), str(b.id))})

    b.blocked_by.remove(a)
    assert driver.get_graph(str(root.id)).edges == frozenset()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_generate_leaf_llds_launches_todo_leaves_and_returns_201(client, project, module, todo, backlog, monkeypatch):
    root = task(project, module, todo, sequence_id=2)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    _child(project, root, backlog, 5, name="C")  # not in Todo → skipped
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{root.id}/generate-leaf-llds",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["root_id"] == str(root.id)
    launched = {run["task_id"] for run in body["runs"]}
    assert launched == {str(a.id), str(b.id)}
    assert {call["task_id"] for call in successful_spawn.calls} == {str(a.id), str(b.id)}


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_launches_task_session_with_codex_and_no_prompt(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "target_id": str(issue.id),
        "agent": "codex",
        "agent_run_id": "run-1",
    }
    # The terminal seam receives Codex, the resolved target project/module/task,
    # scope="task", and NO caller prompt (the ticket context is the prompt).
    call = successful_spawn.calls[0]
    assert call["agent"] == "codex"
    assert call["project_id"] == str(project.id)
    assert call["module_id"] == str(module.id)
    assert call["task_id"] == str(issue.id)
    assert call["scope"] == "task"
    assert "initial_prompt" not in call


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_defaults_to_current_state_binding(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    issue.issue_type = issue_type
    issue.save(update_fields=["issue_type"])
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=todo,
        prompt="Configured workflow prompt",
        agent="claude",
        model="sonnet",
        reasoning="high",
    )
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["agent"] == "claude"
    call = successful_spawn.calls[0]
    assert call["agent"] == "claude"
    assert call["launch_configuration"].prompt == "Configured workflow prompt"
    assert call["launch_configuration"].model == "sonnet"
    assert call["launch_configuration"].reasoning == "high"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_rejects_promptless_current_state(
    client, project, module, todo, monkeypatch
):
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    issue = task(project, module, todo)
    issue.issue_type = issue_type
    issue.save(update_fields=["issue_type"])
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=todo,
        prompt="",
        agent="codex",
    )

    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["error"] == "prompt_not_configured"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_rejects_promptless_current_state(
    client, project, module, todo, monkeypatch
):
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    root = task(project, module, todo, sequence_id=2)
    child = _child(project, root, todo, 3, name="A")
    child.issue_type = issue_type
    child.save(update_fields=["issue_type"])
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=todo,
        prompt="",
        agent="codex",
    )

    async def policy_enforcing_spawn(**kwargs):
        await asyncio.to_thread(
            resolve_task_launch_configuration,
            kwargs["task_id"],
            agent_override=kwargs["agent"],
        )
        return "unreachable"

    monkeypatch.setattr(driver, "spawn_run", policy_enforcing_spawn)

    response = client.post(
        f"/api/work-items/{root.id}/execute-graph",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    node = response.json()["nodes"][0]
    assert node["status"] == "failed"
    assert node["error"] == "prompt_not_configured"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_does_not_move_target_state(client, project, module, todo, monkeypatch):
    issue = task(project, module, todo)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    # A launch is just a launch: no workflow move and no engine state.
    issue.refresh_from_db()
    assert issue.state.group == "unstarted"
    assert driver.get_state(str(issue.id)) is None


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_missing_task_returns_404(client, monkeypatch):
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{uuid.uuid4()}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 404
    assert response.json()["error"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_no_module_ancestry_returns_422(client, project, todo, monkeypatch):
    # A task parented directly under nothing has no module ancestor.
    orphan = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        parent=None,
        state=todo,
        name="Orphan",
        sequence_id=9,
    )
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-items/{orphan.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["error"] == "module_id_required"
    assert successful_spawn.calls == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_no_profile_returns_400(client, project, module, todo, monkeypatch):
    from apps.settings_store.config import NoConfigurationSelected

    issue = task(project, module, todo)

    async def no_profile_spawn(**kwargs):
        raise NoConfigurationSelected("No profile selected.")

    monkeypatch.setattr(driver, "spawn_run", no_profile_spawn)

    response = client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["error"] == "no_profile_selected"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_launch_unavailable_returns_503(client, project, module, todo, monkeypatch):
    from apps.terminals.launch import LaunchUnavailable

    issue = task(project, module, todo)

    async def tmux_down_spawn(**kwargs):
        raise LaunchUnavailable("tmux missing")

    monkeypatch.setattr(driver, "spawn_run", tmux_down_spawn)

    response = client.post(
        f"/api/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 503
    assert response.json()["error"] == "launch_unavailable"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_release_planning_run_clears_lock_and_returns_200(client, project, module, backlog, monkeypatch):
    issue = task(project, module, backlog)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    driver.execute(str(issue.id), agent="codex", phase="refine")
    response = client.delete(f"/api/work-items/{issue.id}/planning-run")

    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == str(issue.id)
    assert body["status"] == "idle"
    assert body["released"]["status"] == "running"
    assert body["released"]["phase"] == "refine"
    assert body["released"]["agent"] == "codex"
    assert body["released"]["agent_run_id"] == "run-1"
    assert driver.get_state(str(issue.id)) is None


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_release_planning_run_missing_returns_404_and_no_mutation(client, project, module, backlog, monkeypatch):
    issue = task(project, module, backlog)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.delete(f"/api/work-items/{issue.id}/planning-run")

    assert response.status_code == 404
    assert response.json()["error"] == "planning_run_not_found"
    issue.refresh_from_db()
    assert issue.state.group == "backlog"
    assert successful_spawn.calls == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_planning_run_manual_release_deletes_entire_row(client, project, module, backlog, monkeypatch):
    from apps.execution.models import EngineRun
    issue = task(project, module, backlog)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    # Launch to seed
    driver.execute(str(issue.id), agent="codex", phase="refine")
    assert EngineRun.objects.filter(pk=issue.id).exists()

    # Manual release
    response = client.delete(f"/api/work-items/{issue.id}/planning-run")
    assert response.status_code == 200

    # Row is completely deleted from the database
    assert not EngineRun.objects.filter(pk=issue.id).exists()
