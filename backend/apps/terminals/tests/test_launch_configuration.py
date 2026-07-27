from __future__ import annotations

import asyncio
import json
import uuid

import pytest

from apps import worktracker_queries
import apps.terminals.launch as launch
import apps.terminals.session as session_module
from apps.terminals.launch_configuration import (
    resolve_task_launch_configuration as real_resolve_task_launch_configuration,
)
from apps.terminals.session import LaunchIntent
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from worktracker.models import Issue, IssueType, LaunchBinding, Project, State, Workspace

from .conftest import write_profiles
from .test_consumers import _fake_tmux_session


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def launch_policy():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(), project=project, type="module", name="Module", sequence_id=1
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=module,
        state=state,
        name="Task",
        sequence_id=2,
    )
    binding = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=state,
        prompt="Configured workflow prompt",
        agent="claude",
        model="sonnet",
        reasoning="high",
    )
    return issue, binding


@pytest.fixture
def provider_catalog():
    """Write the host catalog the way Settings does, then read it back live."""

    from apps.settings_store.models import AppSetting

    def _write(*, activated=("claude", "codex", "gemini"), global_default=None):
        AppSetting.objects.update_or_create(
            scope="host",
            key="provider_catalog",
            defaults={
                "value": json.dumps(
                    {
                        "activated_providers": list(activated),
                        "global_default": global_default,
                    }
                ),
                "updated_at": "2026-07-27T00:00:00+00:00",
            },
        )

    return _write


def test_blank_configuration_launches_the_global_default(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    binding.agent = None
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["agent", "model", "reasoning"])
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4", "reasoning": "high"}
    )

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert resolved.agent == "codex"
    assert resolved.model == "gpt-5.4"
    assert resolved.reasoning == "high"


def test_changing_the_default_takes_effect_on_the_next_launch(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    binding.agent = None
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["agent", "model", "reasoning"])
    provider_catalog(global_default={"provider": "codex", "model": "gpt-5.4"})
    assert real_resolve_task_launch_configuration(str(issue.id)).agent == "codex"

    provider_catalog(global_default={"provider": "gemini", "model": "gemini-2.5-pro"})

    resolved = real_resolve_task_launch_configuration(str(issue.id))
    assert resolved.agent == "gemini"
    assert resolved.model == "gemini-2.5-pro"


def test_resolution_loads_provider_catalog_once(
    launch_policy, provider_catalog, monkeypatch
):
    issue, _binding = launch_policy
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4"}
    )
    from apps.settings_store import provider_catalog as provider_catalog_module

    load_calls = 0
    load_provider_catalog = provider_catalog_module.load_provider_catalog

    def count_catalog_loads():
        nonlocal load_calls
        load_calls += 1
        return load_provider_catalog()

    monkeypatch.setattr(
        provider_catalog_module, "load_provider_catalog", count_catalog_loads
    )

    real_resolve_task_launch_configuration(str(issue.id))

    assert load_calls == 1


def test_explicit_binding_overrides_the_global_default(
    launch_policy, provider_catalog
):
    issue, _binding = launch_policy
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4", "reasoning": "high"}
    )

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert resolved.agent == "claude"
    assert resolved.model == "sonnet"
    assert resolved.reasoning == "high"


def test_deactivated_provider_binding_is_blocked_not_substituted(
    launch_policy, provider_catalog
):
    issue, _binding = launch_policy
    provider_catalog(
        activated=("codex",),
        global_default={"provider": "codex", "model": "gpt-5.4"},
    )

    with pytest.raises(ValueError, match="^provider_not_activated$"):
        real_resolve_task_launch_configuration(str(issue.id))


def test_automated_launch_into_a_blank_state_uses_the_global_default(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    binding.agent = None
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["agent", "model", "reasoning"])
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4", "reasoning": "high"}
    )

    resolved = real_resolve_task_launch_configuration(
        str(issue.id), destination_state_id=str(issue.state_id)
    )

    assert resolved.agent == "codex"
    assert resolved.model == "gpt-5.4"
    assert resolved.reasoning == "high"


def test_blank_configuration_without_a_default_still_refuses_to_launch(launch_policy):
    issue, binding = launch_policy
    binding.agent = None
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["agent", "model", "reasoning"])

    with pytest.raises(ValueError, match="^agent_not_configured$"):
        real_resolve_task_launch_configuration(str(issue.id))


def test_resolver_returns_an_immutable_launch_snapshot(launch_policy):
    issue, binding = launch_policy

    resolved = real_resolve_task_launch_configuration(str(issue.id))
    binding.prompt = "Edited after launch resolution"
    binding.model = "opus"
    binding.save(update_fields=["prompt", "model"])

    assert resolved.prompt == "Configured workflow prompt"
    assert resolved.agent == "claude"
    assert resolved.model == "sonnet"
    assert resolved.reasoning == "high"


def test_explicit_agent_override_drops_other_provider_defaults(launch_policy):
    issue, _binding = launch_policy

    resolved = real_resolve_task_launch_configuration(
        str(issue.id), agent_override="codex"
    )

    assert resolved.agent == "codex"
    assert resolved.model is None
    assert resolved.reasoning is None


def test_promptless_binding_rejects_with_stable_code(launch_policy):
    issue, binding = launch_policy
    binding.prompt = ""
    binding.save(update_fields=["prompt"])

    with pytest.raises(ValueError, match="^prompt_not_configured$"):
        real_resolve_task_launch_configuration(str(issue.id), agent_override="codex")


async def test_task_spawn_carries_one_resolved_snapshot_to_provider_command(
    launch_policy, tmp_config, tmp_path, monkeypatch
):
    issue, binding = launch_policy
    module = issue.parent
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    write_profiles(
        tmp_config,
        [
            {
                "name": "Default",
                "workspace_slug": "meml",
                "agent_prompt": "LEGACY PROFILE PROMPT",
                "agent_prompts": {},
                "module_folders": {str(module.id): str(module_folder)},
                "recent_project_id": None,
                "recent_module_ids": {},
            }
        ],
        recent=0,
    )

    async def get_task_details(project_id, task_id):
        del project_id, task_id
        return TaskDetails(
            task=TaskSummary(
                id=str(issue.id),
                name=issue.name,
                project_id=str(issue.project_id),
                sequence_id=issue.sequence_id,
                state=TaskState(
                    id=str(issue.state_id),
                    name=issue.state.name,
                    group=issue.state.group,
                ),
                issue_type=issue.issue_type.name,
                parent_id=str(module.id),
            )
        )

    async def get_modules(project_id):
        return [
            ModuleSummary(
                id=str(module.id), name=module.name, project_id=str(project_id)
            )
        ]

    monkeypatch.setattr(worktracker_queries, "get_task_details", get_task_details)
    monkeypatch.setattr(worktracker_queries, "get_modules", get_modules)
    resolved = await asyncio.to_thread(
        real_resolve_task_launch_configuration, str(issue.id)
    )
    binding.prompt = "Edited after launch resolution"
    binding.model = "opus"
    await asyncio.to_thread(binding.save, update_fields=["prompt", "model"])

    def unexpected_reresolution(*args, **kwargs):
        raise AssertionError("launch snapshot must not be resolved twice")

    monkeypatch.setattr(
        session_module,
        "resolve_task_launch_configuration",
        unexpected_reresolution,
    )
    captured = {}

    def create_session(**kwargs):
        captured.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(launch.tmux, "create_session", create_session)
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)

    await session_module.session.spawn(
        LaunchIntent(
            agent="claude",
            project_id=str(issue.project_id),
            module_id=str(module.id),
            task_id=str(issue.id),
            launch_configuration=resolved,
        )
    )

    command = captured["command"]
    assert "Configured workflow prompt" in command
    assert "LEGACY PROFILE PROMPT" not in command
    assert "--model sonnet" in command
    assert "--effort high" in command
