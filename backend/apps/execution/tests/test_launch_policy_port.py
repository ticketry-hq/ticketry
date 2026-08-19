from __future__ import annotations

import uuid
import json

import pytest

from apps.execution import driver
from apps.execution.driver import LaunchResult
from apps.execution.launch_policy_port import LaunchPolicyDecisionIn, perform
from apps.execution.models import LaunchPolicyEffect
from apps.runs import rust_port
from apps.runs.models import AutomationAttempt
from worktracker.models import Issue, IssueType, Project, State, Workspace


pytestmark = pytest.mark.django_db(transaction=True)


def test_effect_port_readiness_requires_the_rust_slice2_owner(client, monkeypatch):
    monkeypatch.delenv("TICKETRY_RUST_SLICE2_OWNER", raising=False)
    assert client.get("/api/execution/launch-policy-effects").status_code == 503

    monkeypatch.setenv("TICKETRY_RUST_SLICE2_OWNER", "1")
    response = client.get("/api/execution/launch-policy-effects")

    assert response.status_code == 200
    assert response.json() == {
        "version": 1,
        "ready": True,
        "policy_owner": "rust",
        "effect_owner": "django",
        "django_write_fallback": False,
    }


def test_effect_port_rejects_commands_until_complete_slice2_readiness(
    client, task, monkeypatch, tmp_path
):
    item, module = task
    monkeypatch.setenv("TICKETRY_RUST_SLICE2_OWNER", "1")
    monkeypatch.setenv("MUXED_DATA_DIR", str(tmp_path))
    (tmp_path / "slice2-readiness.json").write_text(
        json.dumps(
            {
                "version": 1,
                "ownership": True,
                "graphql": True,
                "rust_mcp": False,
                "django_effect_port": True,
                "ready": False,
                "django_write_fallback": False,
            }
        )
    )

    response = client.post(
        "/api/execution/launch-policy-effects",
        data=decision(item, module).model_dump(),
        content_type="application/json",
    )

    assert response.status_code == 503
    assert response.json()["code"] == "slice2_not_ready"
    assert not LaunchPolicyEffect.objects.exists()


@pytest.fixture
def task():
    workspace = Workspace.objects.create(
        id=uuid.uuid4(), slug="meml", name="Memory"
    )
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Main", slug="MAIN"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=module_type,
        type="module",
        name="Module",
        sequence_id=1,
    )
    item = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        parent=module,
        state=state,
        name="Task",
        sequence_id=2,
    )
    return item, module


def decision(task, module, *, scope="interactive", identity="launch-1"):
    return LaunchPolicyDecisionIn.model_validate(
        {
            "version": 1,
            "decision_id": uuid.uuid4().hex,
            "policy_identity": "launch-binding:42",
            "policy_version": 17,
            "caller_scope": scope,
            "idempotency_key": identity,
            "task_id": str(task.id),
            "project_id": str(task.project_id),
            "issue_type_id": str(task.issue_type_id),
            "state_id": str(task.state_id),
            "prompt": "Immutable Rust prompt",
            "required_skills": ["tdd"],
            "provider": "codex",
            "model": "gpt-5.6",
            "reasoning": "high",
            "selected_profile": {
                "index": 2,
                "name": "Local",
                "workspace_slug": "meml",
            },
            "module_link": {
                "module_id": str(module.id),
                "path": "/workspace/main",
            },
        }
    )


def test_interactive_effect_performs_the_rust_snapshot_once(task, monkeypatch):
    item, module = task
    calls = []

    def launch(task_id, *, agent, agent_run_id, launch_configuration):
        calls.append((task_id, agent, agent_run_id, launch_configuration))
        return LaunchResult(task_id, launch_configuration.agent, agent_run_id)

    monkeypatch.setattr(driver, "launch_task_agent", launch)
    policy = decision(item, module)

    first = perform(policy)
    second = perform(policy.model_copy(update={"decision_id": uuid.uuid4().hex}))

    assert first[0] == 201
    assert second == (200, first[1])
    assert len(calls) == 1
    configuration = calls[0][3]
    assert configuration.prompt == "Immutable Rust prompt"
    assert configuration.required_skills == ("tdd",)
    assert configuration.selected_profile_index == 2
    assert configuration.module_link_path == "/workspace/main"
    assert configuration.policy_identity == "launch-binding:42"
    assert LaunchPolicyEffect.objects.count() == 1


def test_subtree_effect_passes_the_same_resolved_contract_to_django(task, monkeypatch):
    item, module = task
    calls = []

    def execute(root_id, *, agent, launch_configuration):
        calls.append((root_id, agent, launch_configuration))
        return ["child-1"]

    monkeypatch.setattr(driver, "execute_graph", execute)

    status, result = perform(decision(item, module, scope="subtree"))

    assert status == 201
    assert result == {"root_id": str(item.id), "launched": ["child-1"]}
    assert calls[0][1] == "codex"
    assert calls[0][2].model == "gpt-5.6"
    assert calls[0][2].reasoning == "high"


def test_compatibility_port_rejects_unknown_versions_before_effect(client, task, monkeypatch):
    item, module = task
    monkeypatch.setattr(
        driver,
        "launch_task_agent",
        lambda *args, **kwargs: pytest.fail("invalid decision produced an effect"),
    )
    payload = decision(item, module).model_dump()
    payload["version"] = 2

    response = client.post(
        "/api/execution/launch-policy-effects",
        data=payload,
        content_type="application/json",
    )

    assert response.status_code == 422
    assert not LaunchPolicyEffect.objects.exists()


def test_retry_effect_launches_the_pending_child_under_its_own_run_identity(
    task, monkeypatch
):
    """The retry the user asked for reaches a launch, exactly once.

    Rust appends the pending child and decides; this port performs. The child
    shares its source's transition occurrence, so reusing the failed attempt's
    occurrence-derived Agent Run identity would collide with the run and launch
    effect that attempt already minted — the child names its own run instead.
    """

    item, module = task
    root = AutomationAttempt.objects.create(
        transition_id=uuid.uuid4(),
        issue=item,
        from_state_id=item.state_id,
        to_state_id=item.state_id,
        workflow_revision=17,
        status=AutomationAttempt.Status.FAILED,
        error="launch failed",
    )
    child = AutomationAttempt.objects.create(
        transition_id=root.transition_id,
        issue=item,
        from_state_id=root.from_state_id,
        to_state_id=root.to_state_id,
        workflow_revision=root.workflow_revision,
        retry_of=root,
        root_attempt=root,
    )
    launched = []

    def launch(task_id, *, agent, agent_run_id, launch_configuration):
        launched.append((task_id, agent_run_id, launch_configuration))
        return LaunchResult(task_id, launch_configuration.agent, agent_run_id)

    monkeypatch.setattr(driver, "launch_task_agent", launch)
    monkeypatch.setattr(
        rust_port, "record_attempt_outcome", lambda *args, **kwargs: None
    )
    policy = decision(item, module, scope="retry", identity=child.id.hex)

    status, result = perform(policy)
    replay = perform(policy.model_copy(update={"decision_id": uuid.uuid4().hex}))

    assert status == 201
    assert [call[1] for call in launched] == [child.id.hex]
    assert launched[0][2].prompt == "Immutable Rust prompt"
    assert result["attempt_id"] == str(child.id)
    assert result["target_id"] == str(item.id)
    assert replay == (200, result)
    assert len(launched) == 1


def test_retry_effect_never_relaunches_an_attempt_that_already_settled(
    task, monkeypatch
):
    item, module = task
    root = AutomationAttempt.objects.create(
        transition_id=uuid.uuid4(),
        issue=item,
        from_state_id=item.state_id,
        to_state_id=item.state_id,
        workflow_revision=17,
        status=AutomationAttempt.Status.FAILED,
    )
    child = AutomationAttempt.objects.create(
        transition_id=root.transition_id,
        issue=item,
        from_state_id=root.from_state_id,
        to_state_id=root.to_state_id,
        workflow_revision=root.workflow_revision,
        status=AutomationAttempt.Status.SUCCEEDED,
        agent="codex",
        agent_run_id="run-1",
        retry_of=root,
        root_attempt=root,
    )
    monkeypatch.setattr(
        driver,
        "launch_task_agent",
        lambda *args, **kwargs: pytest.fail("a settled retry was relaunched"),
    )

    status, result = perform(
        decision(item, module, scope="retry", identity=child.id.hex)
    )

    assert status == 201
    assert result == {
        "attempt_id": str(child.id),
        "target_id": str(item.id),
        "agent_run_id": "run-1",
        "status": AutomationAttempt.Status.SUCCEEDED,
    }


def test_completed_receipt_replays_after_process_lock_state_is_lost(task, monkeypatch):
    item, module = task
    policy = decision(item, module, identity="restart-request")
    LaunchPolicyEffect.objects.create(
        decision_id=policy.decision_id,
        caller_scope=policy.caller_scope,
        idempotency_key=policy.idempotency_key,
        result={
            "target_id": str(item.id),
            "agent": "codex",
            "agent_run_id": "restart-request",
        },
    )
    monkeypatch.setattr(
        driver,
        "launch_task_agent",
        lambda *args, **kwargs: pytest.fail("restart replay relaunched"),
    )

    status, result = perform(policy)

    assert status == 200
    assert result["agent_run_id"] == "restart-request"
