from __future__ import annotations

import asyncio
import uuid

import pytest
from django.test import Client, override_settings

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask
from apps.terminals.launch_configuration import resolve_task_launch_configuration
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
    Workspace,
)


pytestmark = pytest.mark.django_db(transaction=True)


def _clear_registry():
    LaunchedTask.objects.all().delete()
    GraphRun.objects.all().delete()


@pytest.fixture(autouse=True)
def clean_registry():
    _clear_registry()
    yield
    _clear_registry()


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )


def _issue_type(project, name, level):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name=name,
        defaults={"id": uuid.uuid4(), "level": level},
    )
    return issue_type


@pytest.fixture
def module(project):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=_issue_type(project, "Module", "module"),
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
    issue_type = _issue_type(project, "Story", "task")
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


def _child(project, parent, state, sequence_id, name="Child"):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=_issue_type(project, "Story", "task"),
        parent=parent,
        state=state,
        name=name,
        sequence_id=sequence_id,
    )


def _catalog_launch_policy(*, provider_slug, model_name, reasoning_name=None):
    provider = Provider.objects.get(slug=provider_slug)
    model, _ = AgentModel.objects.get_or_create(
        provider=provider,
        name=model_name,
    )
    reasoning = None
    if reasoning_name is not None:
        reasoning, _ = ReasoningLevel.objects.get_or_create(name=reasoning_name)
        model.permitted_reasoning_levels.add(reasoning)
    return model, reasoning


async def successful_spawn(**kwargs):
    successful_spawn.calls.append(kwargs)
    return f"run-{len(successful_spawn.calls)}"


successful_spawn.calls = []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize("binding_exists", [False, True])
def test_execute_graph_refuses_root_until_subtree_run_is_enabled(
    client, project, module, todo, monkeypatch, binding_exists
):
    root = task(project, module, todo)
    child = _child(project, root, todo, 3)
    binding = LaunchBinding.objects.get(issue_type=root.issue_type, state=root.state)
    if binding_exists:
        binding.subtree_run_enabled = False
        binding.save(update_fields=["subtree_run_enabled"])
    else:
        binding.delete()
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    refused = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert refused.status_code == 422
    assert refused.json()["code"] == "subtree_run_not_enabled"
    assert successful_spawn.calls == []

    LaunchBinding.objects.update_or_create(
        issue_type=root.issue_type,
        state=root.state,
        defaults={"subtree_run_enabled": True},
    )
    accepted = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert accepted.status_code == 201
    assert accepted.json() == {
        "root_id": str(root.id),
        "launched": [str(child.id)],
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_allows_a_configured_nested_root(
    client, project, module, todo, monkeypatch
):
    top = task(project, module, todo)
    nested = _child(project, top, todo, 3, name="Nested root")
    direct = _child(project, nested, todo, 4, name="Direct child")
    nested.issue_type = top.issue_type
    nested.save(update_fields=["issue_type"])
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{nested.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json() == {
        "root_id": str(nested.id),
        "launched": [str(direct.id)],
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_create_graph_run_conflicts_when_header_is_already_armed(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    b.blocked_by.add(a)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    first = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )
    second = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert first.status_code == 201
    assert first.json() == {"root_id": str(root.id), "launched": [str(a.id)]}
    assert second.status_code == 409
    assert second.json()["code"] == "graph_run_exists"
    header = GraphRun.objects.get(root=root)
    assert (header.project_id, header.module_id, header.agent) == (
        project.id,
        module.id,
        "codex",
    )
    ledger = LaunchedTask.objects.get(task=a)
    assert (ledger.root_id, ledger.agent_run_id) == (root.id, "run-1")
    assert not LaunchedTask.objects.filter(task=b).exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_omits_provider_override(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo)
    child = _child(project, root, todo, 3)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["launched"] == [str(child.id)]
    assert successful_spawn.calls[0]["agent"] is None


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_missing_task_returns_404(client):
    response = client.post(
        f"/api/work-tracker/work-items/{uuid.uuid4()}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 404
    assert response.json()["code"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_empty_direct_child_set_returns_422(
    client, project, module, todo
):
    root = task(project, module, todo)

    response = client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "graph_empty"
    assert not GraphRun.objects.filter(root=root).exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize(
    "method,path_suffix",
    [
        ("get", "dependency-graph"),
        ("post", "execute-graph"),
        ("delete", "execute-graph"),
    ],
)
def test_old_graph_routes_no_longer_resolve(
    client, project, module, todo, method, path_suffix
):
    root = task(project, module, todo)

    response = getattr(client, method)(
        f"/api/work-tracker/work-items/{root.id}/{path_suffix}"
    )

    assert response.status_code == 404


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_graph_returns_cleared_ids_and_launches_nothing(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo)
    a = _child(project, root, todo, 3, name="A")
    b = _child(project, root, todo, 4, name="B")
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)
    client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={"agent": "codex"},
        content_type="application/json",
    )
    calls_before_reset = list(successful_spawn.calls)

    response = client.delete(f"/api/work-tracker/work-items/{root.id}/graph-run")

    assert response.status_code == 200
    assert response.json() == {
        "root_id": str(root.id),
        "cleared": [str(a.id), str(b.id)],
    }
    assert not LaunchedTask.objects.filter(root=root).exists()
    assert not GraphRun.objects.filter(root=root).exists()
    assert successful_spawn.calls == calls_before_reset


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_graph_without_header_returns_404(client, project, module, todo):
    root = task(project, module, todo)

    response = client.delete(f"/api/work-tracker/work-items/{root.id}/graph-run")

    assert response.status_code == 404
    assert response.json()["code"] == "graph_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_returns_factual_subtree_before_any_run(
    client, project, module, todo, done
):
    root = task(project, module, todo)
    blocker = _child(project, root, done, 3, name="Blocker")
    dependent = _child(project, root, todo, 4, name="Dependent")
    nested = _child(project, dependent, todo, 5, name="Nested")
    external = task(project, module, todo, sequence_id=6)
    dependent.blocked_by.add(blocker, external)

    response = client.get(f"/api/work-tracker/work-items/{root.id}/graph-run")

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
    assert LaunchedTask.objects.count() == 0


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_excludes_archived_descendant_branches(
    client, project, module, todo
):
    root = task(project, module, todo)
    visible = _child(project, root, todo, 3, name="Visible")
    archived = _child(project, root, todo, 4, name="Archived")
    archived.is_archived = True
    archived.save(update_fields=["is_archived"])
    _child(project, archived, todo, 5, name="Hidden grandchild")

    response = client.get(f"/api/work-tracker/work-items/{root.id}/graph-run")

    assert response.status_code == 200
    assert [node["id"] for node in response.json()["nodes"]] == [
        str(root.id),
        str(visible.id),
    ]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_get_dependency_graph_returns_not_found_for_unknown_or_archived_root(
    client, project, module, todo
):
    archived = task(project, module, todo)
    archived.is_archived = True
    archived.save(update_fields=["is_archived"])

    for root_id in (uuid.uuid4(), archived.id):
        response = client.get(f"/api/work-tracker/work-items/{root_id}/graph-run")
        assert response.status_code == 404
    assert response.json()["code"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_launches_task_session_with_codex_and_no_prompt(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json() == {
        "target_id": str(issue.id),
        "agent": "codex",
        "agent_run_id": "run-1",
    }
    call = successful_spawn.calls[0]
    assert call == {
        "agent": "codex",
        "project_id": str(project.id),
        "module_id": str(module.id),
        "task_id": str(issue.id),
        "scope": "task",
    }


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_defaults_to_current_state_binding(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)
    model, reasoning = _catalog_launch_policy(
        provider_slug="claude",
        model_name="sonnet",
        reasoning_name="high",
    )
    LaunchBinding.objects.filter(issue_type=issue.issue_type, state=todo).update(
        prompt="Configured workflow prompt",
        model=model,
        reasoning=reasoning,
    )
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["agent"] == "claude"
    configuration = successful_spawn.calls[0]["launch_configuration"]
    assert (configuration.prompt, configuration.model, configuration.reasoning) == (
        "Configured workflow prompt",
        "sonnet",
        "high",
    )


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_rejects_promptless_current_state(client, project, module, todo):
    issue = task(project, module, todo)
    model, _ = _catalog_launch_policy(provider_slug="codex", model_name="gpt-test")
    LaunchBinding.objects.filter(issue_type=issue.issue_type, state=todo).update(
        prompt="", model=model
    )

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "prompt_not_configured"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_execute_graph_spawn_policy_error_writes_no_failure_state(
    client, project, module, todo, monkeypatch
):
    root = task(project, module, todo)
    child = _child(project, root, todo, 3)
    model, _ = _catalog_launch_policy(provider_slug="codex", model_name="gpt-test")
    LaunchBinding.objects.filter(issue_type=child.issue_type, state=todo).update(
        prompt="", model=model
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
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json() == {"root_id": str(root.id), "launched": []}
    assert not LaunchedTask.objects.filter(task=child).exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_does_not_move_target_state_or_seed_subtree_state(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    issue.refresh_from_db()
    assert issue.state.group == "unstarted"
    assert not GraphRun.objects.exists()
    assert not LaunchedTask.objects.exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_missing_task_returns_404(client):
    response = client.post(
        f"/api/work-tracker/work-items/{uuid.uuid4()}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 404
    assert response.json()["code"] == "task_not_found"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_no_module_ancestry_returns_422(
    client, project, todo, monkeypatch
):
    orphan = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=_issue_type(project, "Story", "task"),
        parent=None,
        state=todo,
        name="Orphan",
        sequence_id=9,
    )
    successful_spawn.calls.clear()
    monkeypatch.setattr(driver, "spawn_run", successful_spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{orphan.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "module_id_required"
    assert successful_spawn.calls == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_no_profile_returns_400(
    client, project, module, todo, monkeypatch
):
    from apps.settings_store.config import NoConfigurationSelected

    issue = task(project, module, todo)

    async def no_profile_spawn(**kwargs):
        raise NoConfigurationSelected("No profile selected.")

    monkeypatch.setattr(driver, "spawn_run", no_profile_spawn)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.json()["code"] == "no_profile_selected"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_launch_unavailable_returns_503(
    client, project, module, todo, monkeypatch
):
    from apps.terminals.launch import LaunchUnavailable

    issue = task(project, module, todo)

    async def unavailable_spawn(**kwargs):
        raise LaunchUnavailable("tmux unavailable")

    monkeypatch.setattr(driver, "spawn_run", unavailable_spawn)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={"agent": "codex"},
        content_type="application/json",
    )

    assert response.status_code == 503
    assert response.json()["code"] == "launch_unavailable"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_launch_agent_required_skill_collision_returns_structured_409(
    client, project, module, todo, monkeypatch
):
    issue = task(project, module, todo)

    async def rejected_spawn(**kwargs):
        raise RequiredSkillUnavailable(
            provider="claude",
            skill="grilling",
            reason="collision",
            message="A different provider-visible skill already reserves 'grilling'.",
        )

    monkeypatch.setattr(driver, "spawn_run", rejected_spawn)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/launch-agent",
        data={"agent": "claude"},
        content_type="application/json",
    )

    assert response.status_code == 409
    assert response.json() == {
        "code": "required_skill_unavailable",
        "provider": "claude",
        "skill": "grilling",
        "reason": "collision",
        "detail": "A different provider-visible skill already reserves 'grilling'.",
        "remediation": (
            "Rename the provider-visible skill or change its declared name, then "
            "retry. Ticketry will not modify user-installed skills."
        ),
        "retryable": False,
    }
    assert not GraphRun.objects.exists()
    assert not LaunchedTask.objects.exists()
