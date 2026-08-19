"""Durable launch snapshots: the state and model a run was started with (#693).

A terminal tab names the workflow phase its conversation began in, so that
fact has to be frozen at spawn rather than read back from a work item that
moves on. These tests observe the durable run row and the public projection
after a launch — never the helper that computed the value.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import pytest

from apps import worktracker_queries
from apps.runs import dao as runs_dao
from apps.runs.models import AgentRun
import apps.terminals.launch as session_module
from apps.terminals.agents.skills.preflight import ResolvedSkills
from apps.terminals.launch import LaunchIntent
from apps.terminals.launch_configuration import (
    resolve_task_launch_configuration as real_resolve_task_launch_configuration,
)
from apps.terminals.reconciliation import TerminalReconciler
from apps.terminals.tests.fakes import RecordingTerminalRuntime, patch_terminal_runtime
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    Provider,
    State,
    Workspace,
)

from .conftest import write_profiles

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def workflow():
    """One task sitting in ``Implement``, with a binding for two states."""

    provider, _ = Provider.objects.get_or_create(
        slug="claude",
        defaults={"activated": True, "supports_unattended": True},
    )
    Provider.objects.filter(slug="claude").update(activated=True)
    sonnet, _ = AgentModel.objects.get_or_create(provider=provider, name="sonnet")
    opus, _ = AgentModel.objects.get_or_create(provider=provider, name="opus")
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    implement = State.objects.create(
        id=uuid.uuid4(), project=project, name="Implement", group="started"
    )
    review = State.objects.create(
        id=uuid.uuid4(), project=project, name="Review", group="started"
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
        state=implement,
        name="Task",
        sequence_id=2,
    )
    implement_binding = LaunchBinding.objects.create(
        issue_type=issue_type,
        state=implement,
        prompt="Implement the slice.",
        model=sonnet,
    )
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=review,
        prompt="Review the slice.",
        model=opus,
    )
    return {
        "issue": issue,
        "module": module,
        "implement": implement,
        "review": review,
        "binding": implement_binding,
        "opus": opus,
    }


@dataclass
class LaunchHarness:
    """What a launched run left behind: its live frames and its terminal."""

    published: list[dict]
    runtime: RecordingTerminalRuntime


@pytest.fixture
def launch_harness(workflow, tmp_config, tmp_path, monkeypatch):
    """Make a real launch reach persistence without a real agent or terminal."""

    issue = workflow["issue"]
    module = workflow["module"]
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    write_profiles(
        tmp_config,
        [
            {
                "name": "Default",
                "workspace_slug": "meml",
                "agent_prompt": None,
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

    async def get_task_details(project_id, task_id):
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
    monkeypatch.setattr(
        session_module,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills((), (), frozenset(), ""),
    )
    monkeypatch.setattr(
        session_module.documents_watch, "start_watch", lambda **kwargs: None
    )
    runtime = patch_terminal_runtime(monkeypatch)

    published: list[dict] = []

    async def capture_status(project_id: str, frame: dict) -> None:
        published.append(frame)

    monkeypatch.setattr(session_module, "publish_status", capture_status)
    # The autouse harness fixture stubs the resolver away; these tests are
    # about what the real one resolves.
    monkeypatch.setattr(
        session_module,
        "resolve_task_launch_configuration",
        real_resolve_task_launch_configuration,
    )
    return LaunchHarness(published=published, runtime=runtime)


def _intent(workflow, **overrides) -> LaunchIntent:
    issue = workflow["issue"]
    kwargs = dict(
        agent=None,
        project_id=str(issue.project_id),
        module_id=str(workflow["module"].id),
        task_id=str(issue.id),
        scope="task",
    )
    kwargs.update(overrides)
    return LaunchIntent(**kwargs)


async def test_interactive_task_launch_snapshots_its_state_and_resolved_model(
    workflow, launch_harness
):
    published = launch_harness.published

    run_id = await session_module.launch_agent_run(_intent(workflow))

    run = await AgentRun.objects.aget(id=run_id)
    assert (run.launch_state, run.launch_model) == ("Implement", "sonnet")
    # The live frame published at spawn says exactly what the durable row does,
    # so a client that never fetches a snapshot sees the same run.
    lifecycle = [f for f in published if f.get("type") == "agent_lifecycle"]
    assert [(f["run"]["launch_state"], f["run"]["launch_model"]) for f in lifecycle] == [
        ("Implement", "sonnet")
    ]
    # And the authoritative snapshot agrees with the frame it was published
    # beside — the two projections cannot describe one run differently.
    record = await runs_dao.agent_status_record(run_id)
    assert (record.launch_state, record.launch_model) == (
        lifecycle[0]["run"]["launch_state"],
        lifecycle[0]["run"]["launch_model"],
    )


async def test_automated_launch_snapshots_its_frozen_destination_state(
    workflow, launch_harness
):
    """An automated launch resolves against the committed destination state."""

    issue = workflow["issue"]
    configuration = await asyncio.to_thread(
        real_resolve_task_launch_configuration,
        str(issue.id),
        destination_state_id=str(workflow["review"].id),
    )

    run_id = await session_module.launch_agent_run(
        _intent(workflow, launch_configuration=configuration)
    )

    run = await AgentRun.objects.aget(id=run_id)
    assert (run.launch_state, run.launch_model) == ("Review", "opus")


async def test_launch_snapshots_survive_a_transition_and_a_binding_edit(
    workflow, launch_harness
):
    issue = workflow["issue"]
    binding = workflow["binding"]

    run_id = await session_module.launch_agent_run(_intent(workflow))

    issue.state = workflow["review"]
    await asyncio.to_thread(issue.save, update_fields=["state"])
    binding.model = workflow["opus"]
    await asyncio.to_thread(binding.save, update_fields=["model"])

    run = await AgentRun.objects.aget(id=run_id)
    assert (run.launch_state, run.launch_model) == ("Implement", "sonnet")
    record = await runs_dao.agent_status_record(run_id)
    assert (record.launch_state, record.launch_model) == ("Implement", "sonnet")


async def test_scratch_launch_records_no_launch_metadata(workflow, launch_harness):
    """A plan run has no workflow state, and none is invented for it."""

    run_id = await session_module.launch_agent_run(
        _intent(workflow, agent="claude", scope="plan")
    )

    run = await AgentRun.objects.aget(id=run_id)
    assert (run.launch_state, run.launch_model) == (None, None)
    record = await runs_dao.agent_status_record(run_id)
    assert (record.launch_state, record.launch_model) == (None, None)


async def test_reconciling_an_exited_terminal_leaves_the_snapshots_alone(
    workflow, launch_harness
):
    """Reconciliation records an ending; it does not restate the launch."""

    runtime = launch_harness.runtime
    run_id = await session_module.launch_agent_run(_intent(workflow))
    runtime.present.discard(run_id)
    runtime.exited[run_id] = 0

    await asyncio.to_thread(TerminalReconciler(runtime).reconcile)

    run = await AgentRun.objects.aget(id=run_id)
    assert run.ended_at is not None
    assert (run.launch_state, run.launch_model) == ("Implement", "sonnet")
    record = await runs_dao.agent_status_record(run_id)
    assert (record.launch_state, record.launch_model) == ("Implement", "sonnet")
