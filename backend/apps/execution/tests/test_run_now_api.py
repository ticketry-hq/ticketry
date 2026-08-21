"""Observable HTTP contract for the composed Run Now capability."""

from __future__ import annotations

import uuid

import pytest
from django.test import Client, override_settings

from apps.execution import driver, run_now
from apps.execution.models import GraphRun, LaunchedTask
from apps.runs.models import AgentRun
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.authorization import issue_run_authorization
from apps.terminals.launch import LaunchUnavailable
from apps.terminals.models import AgentTerminalSession
from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
)


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project():
    return Project.objects.create(id=uuid.uuid4(), name="meml", slug="MEML")


@pytest.fixture
def module(project):
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


def _catalog_launch_policy(*, provider_slug, model_name, reasoning_name=None):
    provider = Provider.objects.get(slug=provider_slug)
    model, _ = AgentModel.objects.get_or_create(provider=provider, name=model_name)
    reasoning = None
    if reasoning_name is not None:
        reasoning, _ = ReasoningLevel.objects.get_or_create(name=reasoning_name)
        model.permitted_reasoning_levels.add(reasoning)
    return model, reasoning


def _story(project, module, *, agent_allowed=True, auto_start=False):
    ideas = State.objects.create(
        id=uuid.uuid4(), project=project, name="Ideas", group="backlog"
    )
    implement = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    story_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=ideas,
        workflow_revision=1,
    )
    IssueTypeTransition.objects.create(
        issue_type=story_type,
        from_state=ideas,
        to_state=implement,
        agent_allowed=agent_allowed,
    )
    model, reasoning = _catalog_launch_policy(
        provider_slug="codex",
        model_name="gpt-test",
        reasoning_name="high",
    )
    LaunchBinding.objects.create(
        issue_type=story_type,
        state=implement,
        prompt="Implement this small Story.",
        model=model,
        reasoning=reasoning,
        required_skills=["research"],
        auto_start=auto_start,
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=story_type,
        parent=module,
        module=module,
        state=ideas,
        name="Small idea",
        sequence_id=9,
        description="Make the small change.",
    )
    return issue, ideas, implement


def _agent_run(issue, run_id: str, *, active: bool) -> AgentRun:
    return AgentRun.objects.create(
        id=run_id,
        issue=issue,
        ticket_seq=issue.sequence_id,
        agent="codex",
        status="running" if active else "exited",
        started_at="2026-08-08T10:00:00+00:00",
        ended_at=None if active else "2026-08-08T10:05:00+00:00",
        scope="task",
    )


@override_settings(
    WORKTRACKER_DISABLE_AUTH=False,
    WORKTRACKER_API_TOKEN="run-now-secret",
)
def test_run_now_requires_the_default_api_key(client):
    path = f"/api/work-tracker/work-items/{uuid.uuid4()}/run-now"

    rejected = client.post(path, data={}, content_type="application/json")
    accepted = client.post(
        path,
        data={},
        content_type="application/json",
        HTTP_X_API_KEY="run-now-secret",
    )

    assert rejected.status_code == 401
    assert accepted.status_code == 404


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_rejects_invalid_origin_through_the_drf_serializer(client):
    response = client.post(
        f"/api/work-tracker/work-items/{uuid.uuid4()}/run-now",
        data={"origin": "system"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert "origin" in response.json()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_moves_and_launches_one_preflighted_task_run(
    client, project, module, monkeypatch
):
    issue, _ideas, implement = _story(project, module)
    preflight_calls = []
    monkeypatch.setattr(
        run_now,
        "preflight_task_launch",
        lambda **kwargs: preflight_calls.append(kwargs),
    )
    launches = []

    async def spawn(**kwargs):
        launches.append(kwargs)
        return "run-1"

    monkeypatch.setattr(driver, "spawn_run", spawn)
    response = client.post(
        f"/api/work-tracker/work-items/{project.slug}-{issue.sequence_id}/run-now",
        data={"origin": "agent"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json() == {
        "target_id": str(issue.id),
        "committed_state": {"id": str(implement.id), "name": "Implement"},
        "run": {
            "target_id": str(issue.id),
            "agent": "codex",
            "agent_run_id": "run-1",
        },
    }
    issue.refresh_from_db()
    assert issue.state_id == implement.id
    assert len(launches) == 1
    configuration = launches[0]["launch_configuration"]
    assert (
        configuration.prompt,
        configuration.agent,
        configuration.model,
        configuration.reasoning,
        configuration.required_skills,
    ) == (
        "Implement this small Story.",
        "codex",
        "gpt-test",
        "high",
        ("research",),
    )
    assert preflight_calls == [
        {
            "module_id": str(module.id),
            "launch_configuration": configuration,
        }
    ]
    assert "resolved_skills" not in launches[0]
    assert launches[0]["scope"] == "task"
    assert not GraphRun.objects.exists()
    assert not LaunchedTask.objects.exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_launches_exactly_one_run_when_implement_auto_starts(
    client, project, module, monkeypatch
):
    issue, _ideas, _implement = _story(project, module, auto_start=True)
    monkeypatch.setattr(run_now, "preflight_task_launch", lambda **_kwargs: object())

    async def spawn(**_kwargs):
        run_id = f"run-{await AgentRun.objects.filter(issue=issue).acount() + 1}"
        await AgentRun.objects.acreate(
            id=run_id,
            issue=issue,
            ticket_seq=issue.sequence_id,
            agent="codex",
            status="running",
            scope="task",
        )
        return run_id

    monkeypatch.setattr(driver, "spawn_run", spawn)

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert AgentRun.objects.filter(issue=issue).count() == 1


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize("live_fact", ["run", "terminal"])
def test_run_now_refuses_live_work_without_moving(
    client, project, module, monkeypatch, live_fact
):
    issue, ideas, _implement = _story(project, module)
    run = _agent_run(issue, "run-live", active=live_fact == "run")
    if live_fact == "terminal":
        AgentTerminalSession.objects.create(
            agent_run=run,
            tmux_session_name="run-live",
            task_id=str(issue.id),
            module_id=str(module.id),
            project_id=str(project.id),
            agent="codex",
            created_at="2026-08-08T10:00:00+00:00",
            terminated_at=None,
            scope="task",
        )
    monkeypatch.setattr(
        run_now,
        "preflight_task_launch",
        lambda **_kwargs: pytest.fail("preflight must not run"),
    )

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 409
    assert response.json()["code"] == "task_already_active"
    assert response.json()["committed_state"] is None
    assert response.json()["run"] is None
    issue.refresh_from_db()
    assert issue.state_id == ideas.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_ignores_only_the_callers_live_run(
    client, project, module, monkeypatch
):
    issue, _ideas, implement = _story(project, module)
    caller_run = _agent_run(issue, "run-caller", active=True)
    AgentTerminalSession.objects.create(
        agent_run=caller_run,
        tmux_session_name="run-caller",
        task_id=str(issue.id),
        module_id=str(module.id),
        project_id=str(project.id),
        agent="codex",
        created_at="2026-08-08T10:00:00+00:00",
        terminated_at=None,
        scope="task",
    )
    monkeypatch.setattr(run_now, "preflight_task_launch", lambda **_kwargs: object())

    async def spawn(**_kwargs):
        return "run-implement"

    monkeypatch.setattr(driver, "spawn_run", spawn)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={"origin": "agent"},
        content_type="application/json",
        HTTP_AUTHORIZATION=issue_run_authorization("run-caller"),
    )

    assert response.status_code == 201
    assert response.json()["run"]["agent_run_id"] == "run-implement"
    issue.refresh_from_db()
    assert issue.state_id == implement.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_still_refuses_another_live_run_for_the_callers_target(
    client, project, module, monkeypatch
):
    issue, ideas, _implement = _story(project, module)
    _agent_run(issue, "run-caller", active=True)
    _agent_run(issue, "run-other", active=True)
    monkeypatch.setattr(
        run_now,
        "preflight_task_launch",
        lambda **_kwargs: pytest.fail("preflight must not run"),
    )

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={"origin": "agent"},
        content_type="application/json",
        HTTP_AUTHORIZATION=issue_run_authorization("run-caller"),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "task_already_active"
    issue.refresh_from_db()
    assert issue.state_id == ideas.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_preflight_refusals_leave_the_story_unchanged(
    client, project, module, monkeypatch
):
    issue, ideas, implement = _story(project, module)
    binding = LaunchBinding.objects.get(issue_type=issue.issue_type, state=implement)
    binding.delete()

    missing_binding = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )
    assert missing_binding.status_code == 422
    assert missing_binding.json()["code"] == "binding_not_configured"
    issue.refresh_from_db()
    assert issue.state_id == ideas.id

    LaunchBinding.objects.create(
        issue_type=issue.issue_type,
        state=implement,
        prompt="Implement it.",
        model=binding.model,
        reasoning=binding.reasoning,
    )
    monkeypatch.setattr(
        run_now,
        "preflight_task_launch",
        lambda **_kwargs: (_ for _ in ()).throw(
            RequiredSkillUnavailable(
                provider="codex",
                skill="research",
                reason="unknown",
                message="The skill is unavailable.",
            )
        ),
    )
    no_skill = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )
    assert no_skill.status_code == 409
    assert no_skill.json()["code"] == "required_skill_unavailable"
    issue.refresh_from_db()
    assert issue.state_id == ideas.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_missing_module_ancestry_refuses_before_policy_resolution(
    client, project, module, monkeypatch
):
    issue, ideas, _implement = _story(project, module)
    issue.parent = None
    issue.module = None
    issue.save(update_fields=["parent", "module"])
    monkeypatch.setattr(
        run_now,
        "preflight_task_launch",
        lambda **_kwargs: pytest.fail("preflight must not run"),
    )

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "module_id_required"
    issue.refresh_from_db()
    assert issue.state_id == ideas.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_refuses_a_story_outside_ideas(client, project, module):
    issue, _ideas, implement = _story(project, module)
    issue.state = implement
    issue.save(update_fields=["state", "updated_at"])

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "run_now_not_eligible"
    assert response.json()["committed_state"] is None
    assert response.json()["run"] is None


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_transition_gate_receives_agent_origin(
    client, project, module, monkeypatch
):
    issue, ideas, _implement = _story(project, module, agent_allowed=False)
    monkeypatch.setattr(run_now, "preflight_task_launch", lambda **_kwargs: object())

    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={"origin": "agent"},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "human_only_transition"
    assert response.json()["from"] == "Ideas"
    assert response.json()["to"] == "Implement"
    issue.refresh_from_db()
    assert issue.state_id == ideas.id


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_late_launch_failure_reports_committed_state_without_rollback(
    client, project, module, monkeypatch
):
    issue, _ideas, implement = _story(project, module)
    monkeypatch.setattr(run_now, "preflight_task_launch", lambda **_kwargs: object())

    async def unavailable(**_kwargs):
        raise LaunchUnavailable("tmux unavailable")

    monkeypatch.setattr(driver, "spawn_run", unavailable)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 503
    assert response.json() == {
        "target_id": str(issue.id),
        "committed_state": {"id": str(implement.id), "name": "Implement"},
        "run": None,
        "detail": "launch_unavailable",
        "code": "launch_unavailable",
    }
    issue.refresh_from_db()
    assert issue.state_id == implement.id
    assert not AgentRun.objects.filter(issue=issue).exists()


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_run_now_reports_prompt_delivery_failure_after_committing_state(
    client, project, module, monkeypatch
):
    from apps.terminals.launch import PromptDeliveryFailed

    issue, _ideas, implement = _story(project, module)
    monkeypatch.setattr(run_now, "preflight_task_launch", lambda **_kwargs: object())

    async def failed_delivery(**_kwargs):
        raise PromptDeliveryFailed(reason="readiness_timeout")

    monkeypatch.setattr(driver, "spawn_run", failed_delivery)
    response = client.post(
        f"/api/work-tracker/work-items/{issue.id}/run-now",
        data={},
        content_type="application/json",
    )

    assert response.status_code == 503
    assert response.json() == {
        "target_id": str(issue.id),
        "committed_state": {"id": str(implement.id), "name": "Implement"},
        "run": None,
        "detail": "prompt_delivery_failed",
        "code": "prompt_delivery_failed",
        "reason": "readiness_timeout",
    }
