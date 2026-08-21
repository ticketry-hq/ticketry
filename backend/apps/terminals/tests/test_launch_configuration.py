from __future__ import annotations

import asyncio
import json
import uuid

import pytest

from apps import worktracker_queries
import apps.terminals.launch as launch
import apps.terminals.launch as session_module
from apps.terminals.agents.skills.preflight import ResolvedSkills
from apps.terminals.launch_configuration import (
    resolve_task_launch_configuration as real_resolve_task_launch_configuration,
)
from apps.terminals.launch import LaunchIntent
from apps.terminals.tests.fakes import patch_terminal_runtime
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
)

from .conftest import write_profiles

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def launch_policy():
    provider, _ = Provider.objects.get_or_create(
        slug="claude",
        defaults={"activated": True, "supports_unattended": True},
    )
    reasoning, _ = ReasoningLevel.objects.get_or_create(name="high")
    model, _ = AgentModel.objects.get_or_create(provider=provider, name="sonnet")
    model.permitted_reasoning_levels.add(reasoning)
    AgentModel.objects.get_or_create(provider=provider, name="opus")
    project = Project.objects.create(id=uuid.uuid4(), name="meml", slug="MEML")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Implementation", level="task"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
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
        model=model,
        reasoning=reasoning,
        required_skills=["to-spec"],
        entry_skill="to-spec",
    )
    return issue, binding


@pytest.fixture
def provider_catalog():
    """Write activation rows and the settings-owned default, then read them live."""

    from apps.settings_store.models import AppSetting
    def _write(*, activated=("claude", "codex", "gemini"), global_default=None):
        Provider.objects.update(activated=False)
        Provider.objects.filter(slug__in=activated).update(activated=True)
        if global_default and global_default.get("model"):
            provider = Provider.objects.get(slug=global_default["provider"])
            model, _ = AgentModel.objects.get_or_create(
                provider=provider,
                name=global_default["model"],
            )
            if global_default.get("reasoning"):
                reasoning, _ = ReasoningLevel.objects.get_or_create(
                    name=global_default["reasoning"]
                )
                model.permitted_reasoning_levels.add(reasoning)
        AppSetting.objects.update_or_create(
            scope="host",
            key="provider_catalog",
            defaults={
                "value": json.dumps({"global_default": global_default}),
                "updated_at": "2026-07-27T00:00:00+00:00",
            },
        )

    return _write


def test_blank_configuration_launches_the_global_default(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["model", "reasoning"])
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4", "reasoning": "high"}
    )

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert resolved.agent == "codex"
    assert resolved.model == "gpt-5.4"
    assert resolved.reasoning == "high"


def test_binding_model_does_not_inherit_another_models_default_reasoning(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    provider = Provider.objects.get(slug="codex")
    binding.model = AgentModel.objects.get_or_create(
        provider=provider, name="gpt-5.6-luna"
    )[0]
    binding.reasoning = None
    binding.save(update_fields=["model", "reasoning"])
    provider_catalog(
        global_default={
            "provider": "codex",
            "model": "gpt-5.6-sol",
            "reasoning": "ultra",
        }
    )

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert (resolved.agent, resolved.model, resolved.reasoning) == (
        "codex",
        "gpt-5.6-luna",
        None,
    )


def test_changing_the_default_takes_effect_on_the_next_launch(
    launch_policy, provider_catalog
):
    issue, binding = launch_policy
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["model", "reasoning"])
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
    provider_catalog(global_default={"provider": "codex", "model": "gpt-5.4"})
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


def test_explicit_binding_overrides_the_global_default(launch_policy, provider_catalog):
    issue, _binding = launch_policy
    provider_catalog(
        global_default={"provider": "codex", "model": "gpt-5.4", "reasoning": "high"}
    )

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert resolved.agent == "claude"
    assert resolved.model == "sonnet"
    assert resolved.reasoning == "high"
    assert resolved.required_skills == ("to-spec",)
    assert resolved.entry_skill == "to-spec"


@pytest.mark.parametrize(
    ("source", "model_name", "reasoning_name"),
    (
        ("global_default", "gpt-5.6-terra", "low"),
        ("global_default", "gpt-5.6-luna", "low"),
        ("workflow_binding", "gpt-5.6-terra", "low"),
        ("workflow_binding", "gpt-5.6-luna", "low"),
        ("workflow_binding", "gpt-5.6-luna", None),
    ),
)
def test_codex_catalog_selection_reaches_launch_resolution_unchanged(
    launch_policy,
    provider_catalog,
    source,
    model_name,
    reasoning_name,
):
    issue, binding = launch_policy
    provider = Provider.objects.get(slug="codex")
    model, _ = AgentModel.objects.get_or_create(provider=provider, name=model_name)
    reasoning = (
        ReasoningLevel.objects.get_or_create(name=reasoning_name)[0]
        if reasoning_name is not None
        else None
    )
    if reasoning is not None:
        model.permitted_reasoning_levels.add(reasoning)

    if source == "global_default":
        binding.model = None
        binding.reasoning = None
        binding.save(update_fields=["model", "reasoning"])
        provider_catalog(
            global_default={
                "provider": "codex",
                "model": model_name,
                "reasoning": reasoning_name,
            }
        )
    else:
        binding.model = model
        binding.reasoning = reasoning
        binding.save(update_fields=["model", "reasoning"])
        provider_catalog(global_default=None)

    resolved = real_resolve_task_launch_configuration(str(issue.id))

    assert (resolved.agent, resolved.model, resolved.reasoning) == (
        "codex",
        model_name,
        reasoning_name,
    )


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
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["model", "reasoning"])
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
    binding.model = None
    binding.reasoning = None
    binding.save(update_fields=["model", "reasoning"])

    with pytest.raises(ValueError, match="^agent_not_configured$"):
        real_resolve_task_launch_configuration(str(issue.id))


def test_resolver_returns_an_immutable_launch_snapshot(launch_policy):
    issue, binding = launch_policy

    resolved = real_resolve_task_launch_configuration(str(issue.id))
    binding.prompt = "Edited after launch resolution"
    binding.model = AgentModel.objects.get(provider__slug="claude", name="opus")
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
                "module_links": [
                    {"module_id": str(module.id), "path": str(module_folder)}
                ],
                "recent_project_id": None,
                "recent_module_ids": {},
            }
        ],
        recent=0,
    )

    fetched_tasks = []

    async def get_task_details(project_id, task_id):
        fetched_tasks.append((project_id, task_id))
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
    binding.model = await asyncio.to_thread(
        AgentModel.objects.get,
        provider__slug="claude",
        name="opus",
    )
    await asyncio.to_thread(binding.save, update_fields=["prompt", "model"])

    def unexpected_reresolution(*args, **kwargs):
        raise AssertionError("launch snapshot must not be resolved twice")

    monkeypatch.setattr(
        session_module,
        "resolve_task_launch_configuration",
        unexpected_reresolution,
    )
    runtime = patch_terminal_runtime(monkeypatch)
    monkeypatch.setattr(runtime, "capture_screen", lambda _run_id: "❯ ".encode())
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)
    monkeypatch.setattr(
        session_module,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills(
            ("to-spec",), (), frozenset(), "a" * 40
        ),
    )

    await session_module.launch_agent_run(
        LaunchIntent(
            agent="claude",
            project_id=str(issue.project_id),
            module_id=str(module.id),
            task_id=str(issue.id),
            launch_configuration=resolved,
        )
    )

    command = runtime.requests[0].command
    submitted_message = runtime.submitted[0][1]
    assert fetched_tasks == [(str(issue.project_id), str(issue.id))]
    assert submitted_message == "/to-spec"
    assert "Configured workflow prompt" in command
    assert "Required skills available for this invocation: /to-spec" in command
    assert "Edited after launch resolution" not in command
    assert "Additional user instructions:" not in command
    assert "--plugin-dir" not in command
    assert "LEGACY PROFILE PROMPT" not in command
    assert "--model sonnet" in command
    assert "--effort high" in command
