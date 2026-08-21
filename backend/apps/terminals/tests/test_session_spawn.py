"""Tests for the agent launch service.s ``spawn`` (T800; formerly the #715 ``spawn_run``
primitive).

``launch_agent_run`` starts a coding-agent run for a task with **no
human at a WebSocket** — a run indistinguishable from a human-started one
(detached tmux session, attachable terminal) — and returns its
``agent_run_id``. These tests call the module-level ``session`` instance
directly (no ``WebsocketCommunicator``), reusing the existing repo / argv /
tmux fakes from the consumer suite, and assert the run is persisted and keyed
by ``task_id``, the argv carries the injected lifecycle hooks,
``initial_prompt`` is threaded, #587 worktree rooting wins, and every failure
path raises rather than falling back. No real tmux session is ever created:
every launch/tmux call is faked or monkeypatched.
"""

from __future__ import annotations

import shlex
from pathlib import Path

import pytest
from asgiref.sync import async_to_sync, sync_to_async

from apps import worktracker_queries
import apps.terminals.durable_launch as durable_launch
import apps.terminals.launch as launch
import apps.terminals.prompt_builder as prompt_builder
import apps.terminals.launch as session_module
import apps.terminals.agents.registry as registry
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from apps.terminals.agents.skills.preflight import ResolvedSkills
from apps.terminals.launch_configuration import ResolvedLaunchConfiguration
from apps.terminals.tests.fakes import FakeAdapter, patch_terminal_runtime
from apps.terminals.launch import LaunchIntent
from apps.terminals.tmux._core import TmuxSessionError
from apps.worktrees import dao as worktrees_dao
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from worktracker.tests.factories import fixture_issue_id, fixture_uuid

from .conftest import write_profiles
pytestmark = pytest.mark.django_db(transaction=True)

AGENT = "claude"
PROJECT_ID = "p1"
MODULE_ID = "m1"
TASK_ID = "t1"


def test_desktop_approved_agent_path_replaces_the_bare_agent_command(monkeypatch):
    monkeypatch.setenv("MUXED_APPROVED_CODEX_PATH", "/Applications/Muxed/bin/codex")

    assert launch._approved_agent_argv("codex", ["codex", "resume", "session-1"]) == [
        "/Applications/Muxed/bin/codex",
        "resume",
        "session-1",
    ]


def test_desktop_rejects_a_malformed_approved_agent_path(monkeypatch):
    monkeypatch.setenv("MUXED_APPROVED_CODEX_PATH", "codex")

    with pytest.raises(launch.LaunchUnavailable, match="invalid approved codex path"):
        launch._approved_agent_argv("codex", ["codex", "prompt"])


def _intent(**overrides) -> LaunchIntent:
    kwargs = dict(
        agent=AGENT,
        project_id=PROJECT_ID,
        module_id=MODULE_ID,
        task_id=TASK_ID,
        issue_id=fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
        ),
        scope="task",
    )
    kwargs.update(overrides)
    return LaunchIntent(**kwargs)


def _profile(tmp_config, module_folder) -> None:
    write_profiles(
        tmp_config,
        [
            {
                "name": "Default",
                "workspace_slug": "ws",
                "agent_prompt": None,
                "agent_prompts": {},
                "module_links": [{"module_id": MODULE_ID, "path": str(module_folder)}],
                "recent_project_id": None,
                "recent_module_ids": {},
            }
        ],
        recent=0,
    )


def _task(task_id: str = TASK_ID) -> TaskSummary:
    return TaskSummary(
        id=task_id,
        name="Stub task",
        issue_type="Story",
        sequence_id=42,
        state=TaskState(id="s1", name="Todo", group="unstarted"),
        project_id=PROJECT_ID,
        parent_id=None,
        module_ids=[MODULE_ID],
    )


def _patch_worktracker(monkeypatch, *, task: TaskSummary | None = None) -> None:
    task = task or _task()

    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Platform", project_id=PROJECT_ID)]

    async def fake_get_task_details(project_id, task_id):
        return TaskDetails(task=task)

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fake_get_task_details)


def _capture_create_session(monkeypatch) -> dict:
    """Record the prepared request sent through the public runtime seam."""
    created: dict = {}
    runtime = patch_terminal_runtime(monkeypatch)

    def capture_request(request):
        runtime.requests.append(request)
        runtime.present.add(request.agent_run_id)
        created.update(
            agent_run_id=request.agent_run_id,
            command=request.command,
            cwd=str(request.working_directory),
            environment=dict(request.environment),
            dimensions=request.dimensions,
            submitted=runtime.submitted,
        )

    monkeypatch.setattr(runtime, "create", capture_request)
    # Don't start a real design-dir watcher thread in tests.
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kw: None)
    return created


def _patch_argv(
    monkeypatch,
    *,
    provider="claude",
    invocation_prefix: str | None = None,
) -> None:
    """Override one adapter so launches produce deterministic argv without a CLI.

    The prompt is carried by the provider command as it was before typed prompt
    delivery was introduced.
    """
    fake = FakeAdapter(
        slug=provider,
        command_fn=lambda prompt: [provider, prompt],
        invocation_prefix=(
            registry.get_adapter(provider).invocation_prefix
            if invocation_prefix is None
            else invocation_prefix
        ),
    )
    monkeypatch.setitem(registry._REGISTRY, provider, fake)


# ---------- happy path ----------


async def test_spawn_happy_path_returns_id_and_persists(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    run_id = await session_module.launch_agent_run(_intent())

    # Returns a hex run id.
    assert isinstance(run_id, str) and run_id
    int(run_id, 16)

    # The persisted AgentRun is keyed by its task Issue and running.
    run = await AgentRun.objects.aget(id=run_id)
    assert str(run.issue_id) == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )
    assert run.status == "running"
    assert run.lifecycle_state == "starting"
    assert run.lifecycle_updated_at == run.started_at
    terminal = await AgentTerminalSession.objects.aget(agent_run_id=run_id)
    assert terminal.project_id == fixture_uuid(PROJECT_ID)
    assert terminal.module_id == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=None
    )

    # Persistence owns application metadata while the runtime receives only
    # prepared mechanical inputs.
    assert created["agent_run_id"] == run_id
    assert terminal.task_id == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )
    assert terminal.scope == "task"
    assert created["cwd"] == str(module_folder)
    assert created["dimensions"] == durable_launch.INITIAL_TERMINAL_DIMENSIONS
    assert "claude" in created["command"]
    assert created["command"].startswith("env -u NO_COLOR ")
    assert "Ticketry invocation resources:" not in created["command"]
    assert created["submitted"] == []


async def test_spawn_resolves_required_skills_against_live_worktree(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    worktree_folder = tmp_path / "worktree"
    worktree_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)
    await sync_to_async(worktrees_dao.create)(
        task_id=TASK_ID,
        repo_root=str(module_folder),
        path=str(worktree_folder),
        branch="wt/CODING-635",
        base_branch="main",
        base_commit="0" * 40,
        status="active",
    )
    resolved_cwds = []

    def resolve_skills(**kwargs):
        resolved_cwds.append(kwargs["cwd"])
        return ResolvedSkills(("tdd",), (), frozenset(), "a" * 40)

    monkeypatch.setattr(session_module, "resolve_required_skills", resolve_skills)

    await session_module.launch_agent_run(
        _intent(
            launch_configuration=ResolvedLaunchConfiguration(
                prompt="Implement the task.",
                agent="claude",
                model=None,
                reasoning=None,
                required_skills=("tdd",),
            )
        )
    )

    assert resolved_cwds == [str(worktree_folder)]
    assert created["cwd"] == str(worktree_folder)


@pytest.mark.parametrize(
    ("provider", "invocation_prefix"),
    (("codex", "$"), ("claude", "/")),
)
async def test_spawn_prefixes_required_skills_and_types_only_entry_skill(
    tmp_config, tmp_path, monkeypatch, provider, invocation_prefix
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch, provider=provider)
    monkeypatch.setattr(
        session_module,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills(
            ("to-spec", "to-tickets"), (), frozenset(), "a" * 40
        ),
    )

    run_id = await session_module.launch_agent_run(
        _intent(
            launch_configuration=ResolvedLaunchConfiguration(
                prompt="Write the specification.",
                agent=provider,
                model=None,
                reasoning=None,
                required_skills=("to-spec", "to-tickets"),
                entry_skill="to-spec",
            )
        )
    )

    assert "Write the specification." in created["command"]
    assert (
        "Required skills available for this invocation: "
        f"{invocation_prefix}to-spec, {invocation_prefix}to-tickets"
    ) in created["command"]
    assert created["submitted"] == [(run_id, f"{invocation_prefix}to-spec")]
    assert f"{invocation_prefix}to-tickets" not in created["submitted"][0][1]


async def test_spawn_with_required_skills_and_no_entry_skill_submits_nothing(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)
    monkeypatch.setattr(
        session_module,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills(("to-spec",), (), frozenset(), "a" * 40),
    )

    await session_module.launch_agent_run(
        _intent(
            launch_configuration=ResolvedLaunchConfiguration(
                prompt="Write the specification.",
                agent="claude",
                model=None,
                reasoning=None,
                required_skills=("to-spec",),
            )
        )
    )

    assert (
        "Required skills available for this invocation: /to-spec" in created["command"]
    )
    assert created["submitted"] == []


async def test_spawn_rejects_unknown_prefix_without_an_entry_skill(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch, invocation_prefix="!")
    monkeypatch.setattr(
        session_module,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills(("to-spec",), (), frozenset(), "a" * 40),
    )

    with pytest.raises(ValueError, match="entry skill prefix"):
        await session_module.launch_agent_run(
            _intent(
                launch_configuration=ResolvedLaunchConfiguration(
                    prompt="Write the specification.",
                    agent="claude",
                    model=None,
                    reasoning=None,
                    required_skills=("to-spec",),
                )
            )
        )

    assert created == {}


async def test_spawn_materializes_an_oversized_prompt_command(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    task = _task()
    task.description = "large task context " * 1_000
    _patch_worktracker(monkeypatch, task=task)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)
    monkeypatch.setattr(registry.tempfile, "tempdir", str(tmp_path))

    run_id = await session_module.launch_agent_run(_intent())

    command_parts = shlex.split(created["command"])
    assert len(command_parts) == 1
    wrapper = Path(command_parts[0])
    assert wrapper.name == "launch.sh"
    assert wrapper.stat().st_mode & 0o777 == 0o700
    wrapper_text = wrapper.read_text(encoding="utf-8")
    assert wrapper_text.startswith("#!/bin/sh\nexec env -u NO_COLOR ")
    assert "large task context" in wrapper_text
    assert created["submitted"] == []

    registry.cleanup_temporary_artifacts_for_run(run_id)
    assert not wrapper.exists()


async def test_spawn_resolves_the_active_profiles_module_link(
    tmp_config, tmp_path, monkeypatch
):
    inactive_folder = tmp_path / "inactive-repo"
    active_folder = tmp_path / "active-repo"
    inactive_folder.mkdir()
    active_folder.mkdir()
    write_profiles(
        tmp_config,
        [
            {
                "name": "Inactive",
                "workspace_slug": "ws",
                "module_links": [
                    {"module_id": MODULE_ID, "path": str(inactive_folder)}
                ],
            },
            {
                "name": "Active",
                "workspace_slug": "ws",
                "module_links": [{"module_id": MODULE_ID, "path": str(active_folder)}],
            },
        ],
        recent=1,
    )
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    await session_module.launch_agent_run(_intent())

    assert created["cwd"] == str(active_folder)
    assert str(inactive_folder) not in created["command"]
    assert str(active_folder) in created["command"]
    assert created["submitted"] == []


async def test_spawn_publishes_a_starting_lifecycle_delta(
    tmp_config, tmp_path, monkeypatch
):
    """#979: connected /ws/status clients learn about the spawn immediately —
    a `starting` lifecycle frame rides the status bus at persist time."""

    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    published: list[tuple[str, dict]] = []

    async def fake_publish(project_id: str, frame: dict) -> None:
        published.append((project_id, frame))

    monkeypatch.setattr(launch, "publish_status", fake_publish)

    run_id = await session_module.launch_agent_run(_intent())

    lifecycle = [f for _, f in published if f.get("type") == "agent_lifecycle"]
    assert len(lifecycle) == 1
    frame = lifecycle[0]
    assert published[0][0] == fixture_uuid(PROJECT_ID)
    assert frame["run"] == {
        "agent_run_id": run_id,
        "project_id": fixture_uuid(PROJECT_ID),
        "task_id": fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
        ),
        "module_id": fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=None
        ),
        "agent": "claude",
        "scope": "task",
        # The launch snapshots the run was just persisted with travel on the
        # live frame too, so it cannot disagree with a later snapshot (#693).
        "launch_state": "Todo",
        "launch_model": None,
        "started_at": frame["at"],
        "state": "starting",
        "updated_at": frame["at"],
        # No hosted command has reported a result on a fresh launch.
        "exit_code": None,
        # A fresh launch has produced no output yet: sequence zero, and the
        # creation stamp as the bounded inactivity origin (#661).
        "output_sequence": 0,
        "last_output_at": frame["at"],
        "effective_state": "starting",
    }


async def test_spawn_threads_initial_prompt(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    await session_module.launch_agent_run(
        _intent(initial_prompt="do the thing")
    )

    # initial_prompt is threaded through build_context_prompt(additional_prompt=…).
    assert "do the thing" in created["command"]
    assert created["submitted"] == []


async def test_spawn_roots_in_worktree_when_present(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    worktree = tmp_path / "wt-t1"
    worktree.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    # #587 use-if-exists: the task's live worktree wins over the module folder.
    monkeypatch.setattr(prompt_builder, "_worktree_root", lambda **kw: str(worktree))

    run_id = await session_module.launch_agent_run(_intent())

    assert created["cwd"] == str(worktree)
    run = await AgentRun.objects.aget(id=run_id)
    assert run.cwd == str(worktree)


async def test_spawn_no_worktree_falls_back_to_module_folder(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    monkeypatch.setattr(prompt_builder, "_worktree_root", lambda **kw: None)

    await session_module.launch_agent_run(_intent())

    assert created["cwd"] == str(module_folder)


# ---------- failure paths (raise, never fall back) ----------


async def test_spawn_tmux_failure_raises_and_no_orphan(
    tmp_config, tmp_path, monkeypatch
):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    task = _task()
    task.description = "large task context " * 1_000
    _patch_worktracker(monkeypatch, task=task)
    _patch_argv(monkeypatch)
    monkeypatch.setattr(registry.tempfile, "tempdir", str(tmp_path))

    runtime = patch_terminal_runtime(
        monkeypatch, create_error=TmuxSessionError("no tmux server")
    )
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kw: None)

    with pytest.raises(launch.LaunchUnavailable):
        await session_module.launch_agent_run(_intent())

    # _launch deleted the half-inserted row before raising — no orphan leaks.
    assert await AgentRun.objects.acount() == 0
    assert await AgentTerminalSession.objects.acount() == 0
    assert runtime.terminated
    artifact_parent = tmp_path / "ticketry-agent-runs"
    assert not artifact_parent.exists() or list(artifact_parent.iterdir()) == []


async def test_spawn_without_a_module_link_uses_the_home_fallback(
    tmp_config, monkeypatch
):
    write_profiles(
        tmp_config,
        [{"name": "Default", "workspace_slug": "ws", "module_links": []}],
        recent=0,
    )
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    await session_module.launch_agent_run(_intent())

    assert created["cwd"] == session_module.os.path.expanduser("~")


async def test_spawn_unknown_agent_raises(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _capture_create_session(monkeypatch)
    # No pinning needed: an unregistered slug raises UnknownAgent through
    # get_adapter, which spawn maps to ValueError("unknown_agent").

    with pytest.raises(ValueError, match="unknown_agent"):
        await session_module.launch_agent_run(_intent(agent="bogus"))

    assert await AgentRun.objects.acount() == 0


async def test_spawn_build_error_raises_valueerror(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_argv(monkeypatch)

    async def fail_details(project_id, task_id):
        raise RuntimeError("worktracker down")

    async def fake_get_modules(project_id):
        return [ModuleSummary(id=MODULE_ID, name="Platform", project_id=PROJECT_ID)]

    monkeypatch.setattr(worktracker_queries, "get_modules", fake_get_modules)
    monkeypatch.setattr(worktracker_queries, "get_task_details", fail_details)

    # A _build_prompt error code (here task_fetch_failed) surfaces as ValueError,
    # preserved verbatim, not as LaunchUnavailable.
    with pytest.raises(ValueError, match="task_fetch_failed"):
        await session_module.launch_agent_run(_intent())

    assert await AgentRun.objects.acount() == 0


# ---------- sync entry point ----------


def test_spawn_sync_via_async_to_sync(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    run_id = async_to_sync(session_module.launch_agent_run)(_intent())

    assert isinstance(run_id, str) and run_id
    assert created["agent_run_id"] == run_id
    run = AgentRun.objects.get(id=run_id)
    assert str(run.issue_id) == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )


# ---------- host activation (ADR-0015) ----------


def _deactivate(*providers: str) -> None:
    """Switch provider catalog rows off."""

    from worktracker.models import Provider

    Provider.objects.filter(slug__in=providers).update(activated=False)


@pytest.mark.parametrize("scope", ("plan", "instant", "docchat"))
async def test_spawn_blocks_a_deactivated_provider_on_every_scope(
    tmp_config, tmp_path, monkeypatch, scope
):
    """Only ``scope == "task"`` used to run activation through a real check.

    The spawn request carries both the scope and the provider, so a scratch
    Plan/Instant terminal or a doc chat could name a provider the host had
    switched off and launch it. ADR-0015 says such a launch is blocked, never
    silently substituted, for every scope.
    """

    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)
    await sync_to_async(_deactivate)("claude")

    with pytest.raises(ValueError, match="provider_not_activated"):
        await session_module.launch_agent_run(
            _intent(
                scope=scope,
                initial_prompt="do the thing" if scope == "instant" else None,
                doc_rel_path="doc.html" if scope == "docchat" else None,
                doc_id="d1" if scope == "docchat" else None,
            )
        )

    assert await AgentRun.objects.acount() == 0


def test_activation_gate_returns_the_set_it_read_for_an_activated_provider():
    """The adapter re-uses this read rather than touching the ORM off-path."""

    _deactivate("gemini")

    assert session_module._enforce_provider_activation("claude") == frozenset(
        {"claude", "codex"}
    )


def test_activation_gate_applies_to_every_adapter_row():
    """Every code-owned adapter has a provider row and follows its activation."""

    _deactivate("agy")

    with pytest.raises(ValueError, match="provider_not_activated"):
        session_module._enforce_provider_activation("agy")
