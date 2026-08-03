"""Tests for the Session seam's ``spawn`` (T800; formerly the #715 ``spawn_run``
primitive).

``TerminalSessionService.spawn`` starts a coding-agent run for a task with **no
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

import pytest
from asgiref.sync import async_to_sync, sync_to_async

from apps import worktracker_queries
import apps.terminals.launch as launch
import apps.terminals.prompt_builder as prompt_builder
import apps.terminals.session as session_module
import apps.terminals.agents.registry as registry
from apps.runs.models import AgentRun
from apps.terminals.tests.fakes import FakeAdapter
from apps.terminals.session import LaunchIntent
from apps.settings_store.config import NoConfigurationSelected
from studio_server.contracts import ModuleSummary, TaskDetails, TaskState, TaskSummary
from worktracker.tests.factories import fixture_issue_id, fixture_uuid

from .conftest import write_profiles
from .test_consumers import _fake_tmux_session

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
                "module_folders": {MODULE_ID: str(module_folder)},
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
    """Fake tmux.create_session that records its kwargs; returns the capture dict.

    ``session.spawn`` delegates to ``launch._launch``, which resolves
    ``tmux_sessions.create_session`` and ``documents_watch.start_watch`` inside
    the launch module — so these patches still target ``launch``.
    """
    created: dict = {}

    def fake_create_session(**kwargs):
        created.update(kwargs)
        return _fake_tmux_session(kwargs["agent_run_id"])

    monkeypatch.setattr(launch.tmux, "create_session", fake_create_session)
    # Don't start a real design-dir watcher thread in tests.
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kw: None)
    return created


def _patch_argv(monkeypatch, factory=None) -> None:
    """Override the "claude" adapter (the slug the suite's intents spawn) so
    ``session.spawn`` produces a deterministic argv without a real CLI.

    The suite kept a ``(agent, prompt)`` factory shape; adapt it to the
    adapter's ``command(prompt)`` by pinning the slug to "claude".
    """
    factory = factory or (lambda agent, prompt: ["claude", "--prompt", prompt])
    fake = FakeAdapter(slug="claude", command_fn=lambda prompt: factory("claude", prompt))
    monkeypatch.setitem(registry._REGISTRY, "claude", fake)


# ---------- happy path ----------


async def test_spawn_happy_path_returns_id_and_persists(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    run_id = await session_module.session.spawn(_intent())

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
    assert created["project_id"] == fixture_uuid(PROJECT_ID)
    assert created["module_id"] == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=None
    )

    # create_session (which writes the AgentTerminalSession row) got the run
    # facts keyed by task_id, task scope, the module-folder cwd, and a command
    # built from the agent argv.
    assert created["agent_run_id"] == run_id
    assert created["task_id"] == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )
    assert created["scope"] == "task"
    assert created["cwd"] == str(module_folder)
    assert "claude" in created["command"]
    assert created["command"].startswith("env -u NO_COLOR ")


async def test_spawn_publishes_a_starting_lifecycle_delta(tmp_config, tmp_path, monkeypatch):
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

    run_id = await session_module.session.spawn(_intent())

    lifecycle = [f for _, f in published if f.get("type") == "agent_lifecycle"]
    assert len(lifecycle) == 1
    frame = lifecycle[0]
    assert published[0][0] == fixture_uuid(PROJECT_ID)
    assert frame["run"] == {
        "agent_run_id": run_id,
        "task_id": fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
        ),
        "module_id": fixture_issue_id(
            project_id=PROJECT_ID, module_id=MODULE_ID, task_id=None
        ),
        "scope": "task",
        "state": "starting",
        "updated_at": frame["at"],
    }


async def test_spawn_threads_initial_prompt(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _capture_create_session(monkeypatch)

    seen: dict = {}

    def argv(agent, prompt):
        seen["prompt"] = prompt
        return ["claude", "--prompt", prompt]

    _patch_argv(monkeypatch, argv)

    await session_module.session.spawn(_intent(initial_prompt="do the thing"))

    # initial_prompt is threaded through build_context_prompt(additional_prompt=…).
    assert "do the thing" in seen["prompt"]


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
    monkeypatch.setattr(
        prompt_builder, "_worktree_root", lambda **kw: str(worktree)
    )

    run_id = await session_module.session.spawn(_intent())

    assert created["cwd"] == str(worktree)
    run = await AgentRun.objects.aget(id=run_id)
    assert run.cwd == str(worktree)


async def test_spawn_no_worktree_falls_back_to_module_folder(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    monkeypatch.setattr(prompt_builder, "_worktree_root", lambda **kw: None)

    await session_module.session.spawn(_intent())

    assert created["cwd"] == str(module_folder)


# ---------- failure paths (raise, never fall back) ----------


async def test_spawn_tmux_failure_raises_and_no_orphan(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _patch_argv(monkeypatch)

    def boom(**kwargs):
        raise launch.tmux.TmuxSessionError("no tmux server")

    monkeypatch.setattr(launch.tmux, "create_session", boom)
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kw: None)

    with pytest.raises(launch.LaunchUnavailable):
        await session_module.session.spawn(_intent())

    # _launch deleted the half-inserted row before raising — no orphan leaks.
    assert await AgentRun.objects.acount() == 0


async def test_spawn_no_profile_raises(tmp_config, monkeypatch):
    # tmp_config writes no profiles → no profile selected.
    with pytest.raises(NoConfigurationSelected):
        await session_module.session.spawn(_intent())

    assert await AgentRun.objects.acount() == 0


async def test_spawn_unknown_agent_raises(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    _capture_create_session(monkeypatch)
    # No pinning needed: an unregistered slug raises UnknownAgent through
    # get_adapter, which spawn maps to ValueError("unknown_agent").

    with pytest.raises(ValueError, match="unknown_agent"):
        await session_module.session.spawn(_intent(agent="bogus"))

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
        await session_module.session.spawn(_intent())

    assert await AgentRun.objects.acount() == 0


# ---------- sync entry point ----------


def test_spawn_sync_via_async_to_sync(tmp_config, tmp_path, monkeypatch):
    module_folder = tmp_path / "repo"
    module_folder.mkdir()
    _profile(tmp_config, module_folder)
    _patch_worktracker(monkeypatch)
    created = _capture_create_session(monkeypatch)
    _patch_argv(monkeypatch)

    run_id = async_to_sync(session_module.session.spawn)(_intent())

    assert isinstance(run_id, str) and run_id
    assert created["agent_run_id"] == run_id
    run = AgentRun.objects.get(id=run_id)
    assert str(run.issue_id) == fixture_issue_id(
        project_id=PROJECT_ID, module_id=MODULE_ID, task_id=TASK_ID
    )


# ---------- host activation (ADR-0015) ----------


def _deactivate(*providers: str) -> None:
    """Persist a host catalog with ``providers`` switched off."""

    from apps.settings_store.models import AppSetting
    from apps.settings_store.provider_catalog import (
        PROVIDER_CATALOG_KEY,
        PROVIDER_CATALOG_SCOPE,
        PROVIDER_ORDER,
        ProviderCatalog,
    )

    catalog = ProviderCatalog(
        activated_providers=frozenset(
            provider for provider in PROVIDER_ORDER if provider not in providers
        )
    )
    AppSetting.objects.update_or_create(
        scope=PROVIDER_CATALOG_SCOPE,
        key=PROVIDER_CATALOG_KEY,
        defaults={
            "value": catalog.model_dump_json(),
            "updated_at": "2026-07-27T00:00:00+00:00",
        },
    )


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
        await session_module.session.spawn(
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


def test_activation_gate_leaves_a_non_configurable_adapter_alone():
    """``agy`` is not a configurable provider, so activation never gates it."""

    _deactivate("claude", "codex", "gemini")

    assert session_module._enforce_provider_activation("agy") == frozenset()
