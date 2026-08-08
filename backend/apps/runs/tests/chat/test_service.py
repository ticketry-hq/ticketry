from __future__ import annotations

import asyncio
import sys
import threading
from types import SimpleNamespace

import pytest
from asgiref.sync import sync_to_async

from apps.runs.chat import api as chat_api
from apps.runs.chat import service
from apps.runs.chat.events import replay_events
from apps.runs.models import (
    AgentChatCommand,
    AgentChatLaunchCommand,
    AgentChatSession,
    AgentRun,
)
from apps.terminals.agents.registry import LaunchAugmentation
from apps.terminals.agents.skills.preflight import ResolvedSkills
from apps.terminals.launch_configuration import ResolvedLaunchConfiguration
from apps.terminals.session import LaunchIntent
from worktracker.services.errors import ConflictError
from worktracker.services.projects import delete_project
from worktracker.services.work_items import delete_work_item
from worktracker.tests.factories import ensure_issue


pytestmark = pytest.mark.django_db(transaction=True)


HANGING_TURN_PEER = r"""
import json
import pathlib
import subprocess
import sys
import time

started_path = pathlib.Path(sys.argv[1])
survivor_path = pathlib.Path(sys.argv[2])
child = r'''import pathlib
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(1.5)
pathlib.Path(sys.argv[1]).write_text("survived")
time.sleep(30)
'''

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if "id" not in frame:
        continue
    if method == "initialize":
        print(json.dumps({"id": frame["id"], "result": {}}), flush=True)
    elif method == "thread/start":
        print(
            json.dumps(
                {
                    "id": frame["id"],
                    "result": {"thread": {"id": "hanging-provider-thread"}},
                }
            ),
            flush=True,
        )
    elif method == "turn/start":
        subprocess.Popen(
            [sys.executable, "-u", "-c", child, str(survivor_path)]
        )
        started_path.write_text("started")
        time.sleep(30)
"""


HANGING_RESUME_PEER = r"""
import json
import pathlib
import subprocess
import sys
import time

started_path = pathlib.Path(sys.argv[1])
survivor_path = pathlib.Path(sys.argv[2])
child = r'''import pathlib
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(1.5)
pathlib.Path(sys.argv[1]).write_text("survived")
time.sleep(30)
'''

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if "id" not in frame:
        continue
    if method == "initialize":
        print(json.dumps({"id": frame["id"], "result": {}}), flush=True)
    elif method == "thread/resume":
        subprocess.Popen(
            [sys.executable, "-u", "-c", child, str(survivor_path)]
        )
        started_path.write_text("started")
        time.sleep(30)
"""


class FakeCodexAdapter:
    supports_required_skills = True
    available_worktracker_tools = frozenset({"get_task_details"})

    def __init__(self):
        self.augment_calls = []

    def augment_launch(self, argv, run_id, **kwargs):
        self.augment_calls.append((argv, run_id, kwargs))
        return LaunchAugmentation(
            argv=("/approved/codex", "-c", "mcp_servers={...}", "app-server"),
            environment=(("CHAT_ENV", "1"),),
        )


@pytest.mark.asyncio
async def test_spawn_reuses_prompt_worktree_skill_mcp_and_agent_run_seams(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-launch-project",
        module_id="chat-launch-module",
        task_id="chat-launch-task",
    )
    adapter = FakeCodexAdapter()
    configuration = ResolvedLaunchConfiguration(
        prompt="Workflow instructions",
        agent="codex",
        model="gpt-test",
        reasoning="ultra",
        required_skills=("code-review",),
    )
    captured = {}

    monkeypatch.setattr(
        service,
        "resolve_task_launch_configuration",
        lambda *args, **kwargs: configuration,
    )
    monkeypatch.setattr(service, "_enforce_provider_activation", lambda agent: {agent})
    monkeypatch.setattr(service, "_resolve_profile_index", lambda: 0)
    monkeypatch.setattr(
        service.cfgmod,
        "Config",
        lambda: SimpleNamespace(profiles=[SimpleNamespace(name="Profile")]),
    )
    monkeypatch.setattr(service, "module_link_path", lambda *args: str(tmp_path))

    async def fake_build_prompt(*args, **kwargs):
        captured["prompt_kwargs"] = kwargs
        return (
            "Built task context",
            str(tmp_path / "design"),
            str(tmp_path / "worktree"),
            None,
        )

    monkeypatch.setattr(service, "_build_prompt", fake_build_prompt)
    monkeypatch.setattr(
        service,
        "resolve_required_skills",
        lambda **kwargs: ResolvedSkills(
            requested=("code-review",),
            packages=(),
            required_tools=frozenset({"get_task_details"}),
            upstream_revision="revision",
        ),
    )
    monkeypatch.setattr(service, "skill_prompt_envelope", lambda skills: "SKILL ENVELOPE")
    monkeypatch.setattr(service, "get_adapter", lambda agent: adapter)
    monkeypatch.setattr(service, "_approved_agent_argv", lambda agent, argv: argv)
    monkeypatch.setattr(service, "_resolve_lifecycle_url", lambda: "http://lifecycle")
    monkeypatch.setattr(service, "_env_url", lambda name: "http://mcp")

    async def fake_add(runtime, initial_prompt=None):
        captured["runtime"] = runtime
        captured["registry_prompt"] = initial_prompt

    async def fake_send_turn(runtime, prompt, **kwargs):
        captured["turn_prompt"] = prompt
        captured["turn_kwargs"] = kwargs
        return "turn-1"

    async def fake_publish(project_id, frame):
        captured["status"] = (project_id, frame)

    monkeypatch.setattr(service.runtime_registry, "add", fake_add)
    monkeypatch.setattr(service.CodexChatRuntime, "send_turn", fake_send_turn)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **kwargs: None)

    (tmp_path / "worktree").mkdir()
    run_id = await service.chat_session.spawn(
        LaunchIntent(
            agent="codex",
            project_id="chat-launch-project",
            module_id="chat-launch-module",
            task_id=str(issue.id),
            issue_id=str(issue.id),
            scope="task",
            initial_prompt="User addition",
        )
    )

    run = await AgentRun.objects.aget(id=run_id)
    session = await AgentChatSession.objects.aget(run_id=run_id)
    runtime = captured["runtime"]
    assert run.run_kind == AgentRun.Kind.CHAT
    assert run.agent == "codex"
    assert run.cwd == str(tmp_path / "worktree")
    assert run.design_dir == str(tmp_path / "design")
    assert session.status == AgentChatSession.Status.STARTING
    assert runtime.argv == (
        "/approved/codex",
        "-c",
        "mcp_servers={...}",
        "app-server",
    )
    assert runtime.model == "gpt-test"
    assert runtime.reasoning == "ultra"
    assert runtime.env == {"CHAT_ENV": "1"}
    assert captured["registry_prompt"] is None
    assert captured["turn_prompt"] == "Built task context\n\nSKILL ENVELOPE"
    assert captured["turn_kwargs"]["message_already_audited"] is True
    assert captured["turn_kwargs"]["client_message_id"].startswith(
        service.INITIAL_TURN_COMMAND_PREFIX
    )
    assert captured["prompt_kwargs"]["workflow_prompt"] == "Workflow instructions"
    assert adapter.augment_calls[0][0] == ["codex", "app-server"]
    assert adapter.augment_calls[0][2]["mcp_url"] == "http://mcp"
    assert captured["status"][1]["run"]["run_kind"] == "chat"


@pytest.mark.asyncio
async def test_cancelled_launch_waits_for_persistence_and_cannot_leave_ghost_run(
    monkeypatch,
    tmp_path,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-persist-cancel-project",
        module_id="chat-persist-cancel-module",
        task_id="chat-persist-cancel-task",
    )
    run_id = "chat-persist-cancel"
    persistence_started = threading.Event()
    release_persistence = threading.Event()
    original_persist = service._persist_launch

    def gated_persist(**kwargs):
        persistence_started.set()
        assert release_persistence.wait(timeout=3)
        return original_persist(**kwargs)

    monkeypatch.setattr(service, "_persist_launch", gated_persist)
    persisting = asyncio.create_task(
        service._persist_launch_cancellation_safe(
            agent_run_id=run_id,
            issue_id=str(issue.id),
            cwd=str(tmp_path),
            design_dir=None,
            scope="task",
            started_at="2026-08-08T00:00:00+00:00",
            initial_prompt="Persist this launch intent",
        )
    )
    assert await asyncio.to_thread(persistence_started.wait, 1)
    persisting.cancel()
    await asyncio.sleep(0.05)
    assert not persisting.done()

    release_persistence.set()
    with pytest.raises(asyncio.CancelledError):
        await persisting
    assert not await AgentRun.objects.filter(id=run_id).aexists()
    await asyncio.sleep(0.05)
    assert not await AgentRun.objects.filter(id=run_id).aexists()


@pytest.mark.asyncio
async def test_cancelled_initial_turn_preserves_unknown_delivery_audit(
    monkeypatch,
    tmp_path,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-initial-unknown-project",
        module_id="chat-initial-unknown-module",
        task_id="chat-initial-unknown-task",
    )
    run_id = "chat-initial-unknown"
    request_started = tmp_path / "initial-turn-started"
    survivor_marker = tmp_path / "initial-descendant-survived"
    configuration = ResolvedLaunchConfiguration(
        prompt="Workflow instructions",
        agent="codex",
        model=None,
        reasoning=None,
        required_skills=(),
    )
    augmentation = LaunchAugmentation(
        argv=(
            sys.executable,
            "-u",
            "-c",
            HANGING_TURN_PEER,
            str(request_started),
            str(survivor_marker),
        )
    )
    request_fingerprint = "a" * 64
    await AgentChatLaunchCommand.objects.acreate(
        command_id="initial-unknown-launch",
        request_fingerprint=request_fingerprint,
        agent_run_id=run_id,
    )

    monkeypatch.setattr(service, "_enforce_provider_activation", lambda _agent: None)
    monkeypatch.setattr(service, "_resolve_profile_index", lambda: 0)
    monkeypatch.setattr(
        service.cfgmod,
        "Config",
        lambda: SimpleNamespace(profiles=[SimpleNamespace(name="Profile")]),
    )
    monkeypatch.setattr(service, "module_link_path", lambda *_args: str(tmp_path))

    async def fake_build_prompt(*_args, **_kwargs):
        return "Initial ambiguous prompt", None, None, None

    async def fake_publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(service, "_build_prompt", fake_build_prompt)
    monkeypatch.setattr(
        service,
        "resolve_required_skills",
        lambda **_kwargs: ResolvedSkills((), (), frozenset(), "revision"),
    )
    monkeypatch.setattr(service, "skill_prompt_envelope", lambda _skills: "")
    monkeypatch.setattr(service, "get_adapter", lambda _agent: FakeCodexAdapter())
    monkeypatch.setattr(
        service,
        "_build_app_server_augmentation",
        lambda **_kwargs: augmentation,
    )
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **_kwargs: None)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    spawning = asyncio.create_task(
        service.chat_session.spawn(
            LaunchIntent(
                agent="codex",
                project_id="chat-initial-unknown-project",
                module_id="chat-initial-unknown-module",
                task_id=str(issue.id),
                issue_id=str(issue.id),
                scope="task",
                launch_configuration=configuration,
            ),
            agent_run_id=run_id,
        )
    )
    try:
        for _ in range(200):
            if request_started.exists():
                break
            await asyncio.sleep(0.01)
        assert request_started.exists()
        spawning.cancel()
        with pytest.raises(asyncio.CancelledError):
            await spawning

        await asyncio.sleep(1.6)
        assert not survivor_marker.exists()
        run = await AgentRun.objects.aget(id=run_id)
        session = await AgentChatSession.objects.aget(run=run)
        command = await AgentChatCommand.objects.aget(
            session=session,
            command_id=service._initial_turn_command_id(run_id),
        )
        events = await sync_to_async(replay_events, thread_sensitive=True)(
            agent_run_id=run_id
        )
        failure = next(
            event
            for event in events
            if event.event_type == "thread.message-failed"
        )
        assert failure.payload["deliveryUnknown"] is True
        assert failure.payload["retryable"] is False
        assert command.status == AgentChatCommand.Status.FAILED
        assert session.provider_thread_id == "hanging-provider-thread"
        assert session.status == AgentChatSession.Status.INTERRUPTED
        assert run.status == "interrupted"

        await AgentChatLaunchCommand.objects.filter(
            command_id="initial-unknown-launch"
        ).aupdate(status=AgentChatLaunchCommand.Status.FAILED)
        with pytest.raises(service.ChatRunError) as rejected:
            await sync_to_async(
                chat_api._claim_create_chat_command,
                thread_sensitive=True,
            )("initial-unknown-launch", request_fingerprint)
        assert rejected.value.code == "command_failed"
    finally:
        if not spawning.done():
            spawning.cancel()
            await asyncio.gather(spawning, return_exceptions=True)
        await service.runtime_registry.remove(run_id)


@pytest.mark.asyncio
async def test_resume_reuses_same_run_and_persisted_provider_thread(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-resume-project",
        module_id="chat-resume-module",
        task_id="chat-resume-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-resume",
        issue_id=issue.id,
        agent="codex",
        status="exited",
        started_at="2026-08-08T00:00:00+00:00",
        ended_at="2026-08-08T00:10:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="exited",
        lifecycle_updated_at="2026-08-08T00:10:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-thread-1",
        status=AgentChatSession.Status.INTERRUPTED,
    )
    adapter = FakeCodexAdapter()
    captured = {}
    monkeypatch.setattr(service, "get_adapter", lambda agent: adapter)
    monkeypatch.setattr(service, "_approved_agent_argv", lambda agent, argv: argv)
    monkeypatch.setattr(service, "_resolve_lifecycle_url", lambda: "http://lifecycle")
    monkeypatch.setattr(service, "_env_url", lambda name: "http://mcp")

    async def fake_add(runtime, initial_prompt=None):
        captured["runtime"] = runtime

    async def fake_publish(project_id, frame):
        captured["status"] = frame

    monkeypatch.setattr(service.runtime_registry, "add", fake_add)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **kwargs: None)

    resumed_id = await service.chat_session.resume(run.id)

    refreshed_run = await AgentRun.objects.aget(id=run.id)
    refreshed_session = await AgentChatSession.objects.aget(run_id=run.id)
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert resumed_id == run.id
    assert captured["runtime"].resume_thread_id == "provider-thread-1"
    assert refreshed_run.status == "running"
    assert refreshed_run.ended_at is None
    assert refreshed_session.status == AgentChatSession.Status.READY
    assert refreshed_session.resume_token is None
    assert events[-1].event_type == "thread.session-resumed"
    assert captured["status"]["run"]["run_kind"] == "chat"


@pytest.mark.asyncio
async def test_resume_watcher_start_failure_contains_live_runtime(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-watch-project",
        module_id="chat-watch-module",
        task_id="chat-watch-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-watch-failure",
        issue_id=issue.id,
        agent="codex",
        status="interrupted",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-watch-thread",
        status=AgentChatSession.Status.INTERRUPTED,
    )
    adapter = FakeCodexAdapter()
    removed = []
    cleaned = []
    monkeypatch.setattr(service, "get_adapter", lambda agent: adapter)
    monkeypatch.setattr(service, "_approved_agent_argv", lambda agent, argv: argv)
    monkeypatch.setattr(service, "_resolve_lifecycle_url", lambda: "http://lifecycle")
    monkeypatch.setattr(service, "_env_url", lambda name: "http://mcp")

    async def fake_add(runtime, initial_prompt=None):
        return None

    async def fake_remove(run_id, *, resumable=False):
        removed.append((run_id, resumable))

    monkeypatch.setattr(service.runtime_registry, "add", fake_add)
    monkeypatch.setattr(service.runtime_registry, "remove", fake_remove)
    monkeypatch.setattr(
        service.documents_watch,
        "start_watch",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("watch failed")),
    )
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda run_id: cleaned.append(run_id),
    )

    with pytest.raises(RuntimeError, match="watch failed"):
        await service.chat_session.resume(run.id)

    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert removed == [(run.id, True)]
    assert cleaned == [run.id]
    assert run.status == "interrupted"
    assert session.status == AgentChatSession.Status.INTERRUPTED


@pytest.mark.asyncio
async def test_resume_does_not_overwrite_an_immediate_process_exit(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-resume-exit-project",
        module_id="chat-resume-exit-module",
        task_id="chat-resume-exit-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-resume-immediate-exit",
        issue_id=issue.id,
        agent="codex",
        status="interrupted",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-immediate-exit",
        status=AgentChatSession.Status.INTERRUPTED,
    )
    adapter = FakeCodexAdapter()
    removed = []
    monkeypatch.setattr(service, "get_adapter", lambda agent: adapter)
    monkeypatch.setattr(service, "_approved_agent_argv", lambda agent, argv: argv)
    monkeypatch.setattr(service, "_resolve_lifecycle_url", lambda: "http://lifecycle")
    monkeypatch.setattr(service, "_env_url", lambda name: "http://mcp")

    async def fake_add(runtime, initial_prompt=None):
        await AgentChatSession.objects.filter(run_id=runtime.agent_run_id).aupdate(
            status=AgentChatSession.Status.ERROR,
            resume_token=None,
            last_error="provider exited",
        )
        await AgentRun.objects.filter(id=runtime.agent_run_id).aupdate(
            status="exited",
            error="provider exited",
            lifecycle_state="error",
        )

    async def fake_remove(run_id, *, resumable=False):
        removed.append((run_id, resumable))

    monkeypatch.setattr(service.runtime_registry, "add", fake_add)
    monkeypatch.setattr(service.runtime_registry, "remove", fake_remove)
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **kwargs: None)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )
    monkeypatch.setattr(
        service,
        "publish_status",
        lambda *_args, **_kwargs: pytest.fail("stale ready status was published"),
    )

    with pytest.raises(service.ChatRunError) as rejected:
        await service.chat_session.resume(run.id)

    assert rejected.value.code == "runtime_state_conflict"
    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert run.status == "exited"
    assert run.lifecycle_state == "error"
    assert session.status == AgentChatSession.Status.ERROR
    assert session.last_error == "provider exited"
    assert session.resume_token is None
    assert not any(event.event_type == "thread.session-resumed" for event in events)
    assert removed == [(run.id, True)]


@pytest.mark.asyncio
async def test_concurrent_resume_loser_never_poisons_the_winning_claim(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-resume-race-project",
        module_id="chat-resume-race-module",
        task_id="chat-resume-race-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-resume-race",
        issue_id=issue.id,
        agent="codex",
        status="interrupted",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-resume-race",
        status=AgentChatSession.Status.INTERRUPTED,
    )
    adapter = FakeCodexAdapter()
    add_started = asyncio.Event()
    release_add = asyncio.Event()
    live = False
    add_calls = 0

    monkeypatch.setattr(service, "get_adapter", lambda agent: adapter)
    monkeypatch.setattr(service, "_approved_agent_argv", lambda agent, argv: argv)
    monkeypatch.setattr(service, "_resolve_lifecycle_url", lambda: "http://lifecycle")
    monkeypatch.setattr(service, "_env_url", lambda name: "http://mcp")

    def fake_get(_run_id):
        if live:
            return object()
        raise KeyError(_run_id)

    async def fake_add(_runtime, initial_prompt=None):
        nonlocal add_calls, live
        add_calls += 1
        add_started.set()
        await release_add.wait()
        live = True

    async def fake_publish(_project_id, _frame):
        return None

    monkeypatch.setattr(service.runtime_registry, "get", fake_get)
    monkeypatch.setattr(service.runtime_registry, "add", fake_add)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **kwargs: None)

    winner = asyncio.create_task(service.chat_session.resume(run.id))
    await add_started.wait()
    loser = asyncio.create_task(service.chat_session.resume(run.id))
    await asyncio.sleep(0)
    assert not loser.done()
    release_add.set()

    assert await winner == run.id
    with pytest.raises(service.ChatRunError) as rejected:
        await loser
    assert rejected.value.code == "run_still_active"
    assert add_calls == 1
    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert run.status == "running"
    assert run.error is None
    assert session.status == AgentChatSession.Status.READY
    assert session.last_error is None
    assert session.resume_token is None


@pytest.mark.asyncio
async def test_stop_revokes_resume_and_stopped_session_cannot_restart(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-stop-resume-project",
        module_id="chat-stop-resume-module",
        task_id="chat-stop-resume-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-stop-resume-race",
        issue_id=issue.id,
        agent="codex",
        status="interrupted",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-stop-resume",
        status=AgentChatSession.Status.INTERRUPTED,
        resume_token="stale-resume-owner",
    )
    remove_started = asyncio.Event()
    release_remove = asyncio.Event()

    def missing_runtime(_run_id):
        raise KeyError(_run_id)

    async def gated_remove(_run_id, *, resumable=False):
        remove_started.set()
        await release_remove.wait()

    async def fake_publish(_project_id, _frame):
        return None

    monkeypatch.setattr(service.runtime_registry, "get", missing_runtime)
    monkeypatch.setattr(service.runtime_registry, "remove", gated_remove)
    monkeypatch.setattr(
        service.runtime_registry,
        "add",
        lambda *_args, **_kwargs: pytest.fail("stopped run was relaunched"),
    )
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    stopping = asyncio.create_task(service.chat_session.stop(run.id))
    await remove_started.wait()
    session = await AgentChatSession.objects.aget(run=run)
    assert session.status == AgentChatSession.Status.INTERRUPTED
    assert session.resume_token == "stale-resume-owner"

    resuming = asyncio.create_task(service.chat_session.resume(run.id))
    await asyncio.sleep(0)
    assert resuming.done()
    release_remove.set()

    assert await stopping is False
    with pytest.raises(service.ChatRunError) as rejected:
        await resuming
    assert rejected.value.code == "chat_runtime_unavailable"
    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert run.status == "terminated"
    assert session.status == AgentChatSession.Status.STOPPED
    assert session.resume_token is None


@pytest.mark.asyncio
async def test_stop_preempts_in_flight_spawn_and_closes_its_created_run(
    monkeypatch,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-spawn-stop-project",
        module_id="chat-spawn-stop-module",
        task_id="chat-spawn-stop-task",
    )
    run_id = "chat-spawn-stop-race"
    row_visible = asyncio.Event()

    async def gated_spawn(_intent, *, agent_run_id):
        assert agent_run_id == run_id
        run = await AgentRun.objects.acreate(
            id=run_id,
            issue_id=issue.id,
            agent="codex",
            status="running",
            started_at="2026-08-08T00:00:00+00:00",
            lifecycle_state="starting",
            lifecycle_updated_at="2026-08-08T00:00:00+00:00",
            scope="task",
            run_kind=AgentRun.Kind.CHAT,
        )
        await AgentChatSession.objects.acreate(run=run)
        row_visible.set()
        await asyncio.Future()
        return run_id

    def missing_runtime(_run_id):
        raise KeyError(_run_id)

    async def fake_remove(_run_id):
        return None

    async def fake_publish(*_args):
        return None

    monkeypatch.setattr(service.chat_session, "_spawn_locked", gated_spawn)
    monkeypatch.setattr(service.runtime_registry, "get", missing_runtime)
    monkeypatch.setattr(service.runtime_registry, "remove", fake_remove)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    spawning = asyncio.create_task(
        service.chat_session.spawn(
            LaunchIntent(
                agent="codex",
                project_id="chat-spawn-stop-project",
                module_id="chat-spawn-stop-module",
                task_id=str(issue.id),
                issue_id=str(issue.id),
                scope="task",
            ),
            agent_run_id=run_id,
        )
    )
    await row_visible.wait()
    stopping = asyncio.create_task(service.chat_session.stop(run_id))
    with pytest.raises(asyncio.CancelledError):
        await spawning
    assert await asyncio.wait_for(stopping, timeout=1) is False

    run = await AgentRun.objects.aget(id=run_id)
    session = await AgentChatSession.objects.aget(run_id=run_id)
    assert run.status == "terminated"
    assert session.status == AgentChatSession.Status.STOPPED


@pytest.mark.asyncio
async def test_stop_preempts_hung_resume_and_contains_provider_tree(
    monkeypatch,
    tmp_path,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-hung-resume-project",
        module_id="chat-hung-resume-module",
        task_id="chat-hung-resume-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-hung-resume",
        issue_id=issue.id,
        agent="codex",
        status="interrupted",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-hung-resume",
        status=AgentChatSession.Status.INTERRUPTED,
    )
    request_started = tmp_path / "resume-started"
    survivor_marker = tmp_path / "resume-descendant-survived"
    augmentation = LaunchAugmentation(
        argv=(
            sys.executable,
            "-u",
            "-c",
            HANGING_RESUME_PEER,
            str(request_started),
            str(survivor_marker),
        )
    )

    async def fake_publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        service,
        "_build_app_server_augmentation",
        lambda **_kwargs: augmentation,
    )
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(
        service.CodexChatRuntime,
        "_publish_lifecycle",
        fake_publish,
    )
    monkeypatch.setattr(service.documents_watch, "start_watch", lambda **_kwargs: None)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    resuming = asyncio.create_task(service.chat_session.resume(run.id))
    try:
        for _ in range(200):
            if request_started.exists():
                break
            await asyncio.sleep(0.01)
        assert request_started.exists()

        assert await asyncio.wait_for(
            service.chat_session.stop(run.id),
            timeout=4,
        ) is False
        with pytest.raises(asyncio.CancelledError):
            await resuming

        await asyncio.sleep(1.6)
        assert not survivor_marker.exists()
        await run.arefresh_from_db()
        session = await AgentChatSession.objects.aget(run=run)
        assert run.status == "terminated"
        assert session.status == AgentChatSession.Status.STOPPED
        assert session.resume_token is None
        with pytest.raises(KeyError):
            service.runtime_registry.get(run.id)
    finally:
        if not resuming.done():
            resuming.cancel()
            await asyncio.gather(resuming, return_exceptions=True)
        await service.runtime_registry.remove(run.id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    ["send_turn", "interrupt", "approval", "user_input"],
)
async def test_stop_linearizes_before_every_mutating_runtime_command(
    monkeypatch,
    tmp_path,
    operation,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id=f"chat-command-stop-{operation}-project",
        module_id=f"chat-command-stop-{operation}-module",
        task_id=f"chat-command-stop-{operation}-task",
    )
    run = await AgentRun.objects.acreate(
        id=f"chat-command-stop-{operation}",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-command-stop",
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="active-turn",
    )
    remove_started = asyncio.Event()
    release_remove = asyncio.Event()
    live = True
    runtime_calls: list[str] = []

    class FakeRuntime:
        active_turn_id = "active-turn"

        async def send_turn(self, *_args, **_kwargs):
            runtime_calls.append("send_turn")

        async def interrupt(self):
            runtime_calls.append("interrupt")

        async def respond_to_approval(self, *_args):
            runtime_calls.append("approval")

        async def respond_to_user_input(self, *_args):
            runtime_calls.append("user_input")

    runtime = FakeRuntime()

    def fake_get(_run_id):
        if live:
            return runtime
        raise KeyError(_run_id)

    async def gated_remove(_run_id):
        nonlocal live
        remove_started.set()
        await release_remove.wait()
        live = False

    async def fake_publish(*_args):
        return None

    monkeypatch.setattr(service.runtime_registry, "get", fake_get)
    monkeypatch.setattr(service.runtime_registry, "remove", gated_remove)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    async def invoke():
        if operation == "send_turn":
            return await service.chat_session.send_turn(run.id, "do work")
        if operation == "interrupt":
            return await service.chat_session.interrupt(run.id)
        if operation == "approval":
            return await service.chat_session.respond_to_approval(
                run.id,
                "request-1",
                "accept",
            )
        return await service.chat_session.respond_to_user_input(
            run.id,
            "request-1",
            {"question": ["answer"]},
        )

    stopping = asyncio.create_task(service.chat_session.stop(run.id))
    await remove_started.wait()
    command = asyncio.create_task(invoke())
    await asyncio.sleep(0)
    assert command.done()

    release_remove.set()
    assert await stopping is True
    with pytest.raises(service.ChatRunError) as rejected:
        await command
    assert rejected.value.code == "chat_runtime_unavailable"
    assert runtime_calls == []


@pytest.mark.asyncio
async def test_stop_preempts_hung_turn_and_contains_provider_tree(
    monkeypatch,
    tmp_path,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-hung-stop-project",
        module_id="chat-hung-stop-module",
        task_id="chat-hung-stop-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-hung-stop",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(run=run)
    request_started = tmp_path / "turn-started"
    survivor_marker = tmp_path / "descendant-survived"
    runtime = service.CodexChatRuntime(
        agent_run_id=run.id,
        argv=[
            sys.executable,
            "-u",
            "-c",
            HANGING_TURN_PEER,
            str(request_started),
            str(survivor_marker),
        ],
        cwd=str(tmp_path),
        version="test",
    )

    async def fake_publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(
        service.CodexChatRuntime,
        "_publish_lifecycle",
        fake_publish,
    )
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    sending: asyncio.Task[str] | None = None
    try:
        await service.runtime_registry.add(runtime)
        sending = asyncio.create_task(
            service.chat_session.send_turn(
                run.id,
                "hang after accepting this turn",
                command_id="hung-turn-command",
            )
        )
        for _ in range(200):
            if request_started.exists():
                break
            await asyncio.sleep(0.01)
        assert request_started.exists()

        assert await asyncio.wait_for(
            service.chat_session.stop(run.id),
            timeout=4,
        ) is True
        with pytest.raises(asyncio.CancelledError):
            await sending

        # The provider deliberately leaves a SIGTERM-immune descendant. The
        # watchdog must escalate and contain it before Stop reports success.
        await asyncio.sleep(1.6)
        assert not survivor_marker.exists()

        await run.arefresh_from_db()
        session = await AgentChatSession.objects.aget(run=run)
        command = await AgentChatCommand.objects.aget(
            session=session,
            command_id="hung-turn-command",
        )
        events = await sync_to_async(replay_events, thread_sensitive=True)(
            agent_run_id=run.id
        )
        delivery_failure = next(
            event
            for event in events
            if event.event_type == "thread.message-failed"
            and event.payload.get("id") == "hung-turn-command"
        )
        assert delivery_failure.payload["deliveryUnknown"] is True
        assert delivery_failure.payload["retryable"] is False
        stopped_event = next(
            event
            for event in events
            if event.event_type == "thread.session-stopped"
        )
        assert delivery_failure.sequence < stopped_event.sequence
        assert command.status == AgentChatCommand.Status.FAILED
        assert run.status == "terminated"
        assert session.status == AgentChatSession.Status.STOPPED
        with pytest.raises(KeyError):
            service.runtime_registry.get(run.id)
        with pytest.raises(service.ChatRunError) as rejected:
            await service.chat_session.send_turn(run.id, "do not redeliver")
        assert rejected.value.code == "chat_runtime_unavailable"
    finally:
        if sending is not None and not sending.done():
            sending.cancel()
            await asyncio.gather(sending, return_exceptions=True)
        await service.runtime_registry.remove(run.id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("delete_scope", "live_session_status"),
    [
        ("work_item", AgentChatSession.Status.ERROR),
        ("project", AgentChatSession.Status.STARTING),
    ],
)
async def test_aggregate_delete_cannot_orphan_live_provider_tree(
    monkeypatch,
    tmp_path,
    delete_scope,
    live_session_status,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id=f"chat-delete-live-{delete_scope}-project",
        module_id=f"chat-delete-live-{delete_scope}-module",
        task_id=f"chat-delete-live-{delete_scope}-task",
    )
    run = await AgentRun.objects.acreate(
        id=f"chat-delete-live-{delete_scope}",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(run=run)
    request_started = tmp_path / f"delete-{delete_scope}-turn-started"
    survivor_marker = tmp_path / f"delete-{delete_scope}-descendant-survived"
    runtime = service.CodexChatRuntime(
        agent_run_id=run.id,
        argv=[
            sys.executable,
            "-u",
            "-c",
            HANGING_TURN_PEER,
            str(request_started),
            str(survivor_marker),
        ],
        cwd=str(tmp_path),
        version="test",
    )

    async def fake_publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(
        service.CodexChatRuntime,
        "_publish_lifecycle",
        fake_publish,
    )
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    sending: asyncio.Task[str] | None = None
    try:
        await service.runtime_registry.add(runtime)
        sending = asyncio.create_task(
            service.chat_session.send_turn(
                run.id,
                "Keep ownership while deletion is attempted",
                command_id=f"delete-live-{delete_scope}-turn",
            )
        )
        for _ in range(200):
            if request_started.exists():
                break
            await asyncio.sleep(0.01)
        assert request_started.exists()
        await AgentChatSession.objects.filter(run=run).aupdate(
            status=live_session_status
        )

        with pytest.raises(ConflictError):
            if delete_scope == "work_item":
                await sync_to_async(delete_work_item, thread_sensitive=True)(issue.id)
            else:
                await sync_to_async(delete_project, thread_sensitive=True)(
                    issue.project_id
                )

        assert await AgentRun.objects.filter(id=run.id).aexists()
        assert await AgentChatSession.objects.filter(run=run).aexists()
        assert service.runtime_registry.get(run.id) is runtime

        assert await asyncio.wait_for(
            service.chat_session.stop(run.id),
            timeout=4,
        ) is True
        with pytest.raises(asyncio.CancelledError):
            await sending
        await asyncio.sleep(1.6)
        assert not survivor_marker.exists()
    finally:
        if sending is not None and not sending.done():
            sending.cancel()
            await asyncio.gather(sending, return_exceptions=True)
        await service.runtime_registry.remove(run.id)


@pytest.mark.asyncio
async def test_stale_resume_failure_token_cannot_mutate_winner(tmp_path):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-resume-owner-project",
        module_id="chat-resume-owner-module",
        task_id="chat-resume-owner-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-resume-owner",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="starting",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-resume-owner",
        status=AgentChatSession.Status.STARTING,
        resume_token="winning-resume-token",
    )

    mutated = await sync_to_async(
        service.chat_session._mark_resume_failed,
        thread_sensitive=True,
    )(run.id, "losing-resume-token", "loser failed")

    assert mutated is False
    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert run.status == "running"
    assert run.error is None
    assert session.status == AgentChatSession.Status.STARTING
    assert session.last_error is None
    assert session.resume_token == "winning-resume-token"


@pytest.mark.asyncio
async def test_stop_closes_durable_run_once_even_when_runtime_is_already_gone(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-stop-project",
        module_id="chat-stop-module",
        task_id="chat-stop-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-stop",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-thread-stop",
        status=AgentChatSession.Status.INTERRUPTED,
    )

    def missing_runtime(agent_run_id):
        raise KeyError(agent_run_id)

    async def fake_remove(agent_run_id):
        return None

    async def fake_publish(project_id, frame):
        return None

    monkeypatch.setattr(service.runtime_registry, "get", missing_runtime)
    monkeypatch.setattr(service.runtime_registry, "remove", fake_remove)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda run_id: None)
    monkeypatch.setattr(
        service, "cleanup_temporary_artifacts_for_run", lambda run_id: None
    )

    assert await service.chat_session.stop(run.id) is False
    assert await service.chat_session.stop(run.id) is False

    refreshed = await AgentRun.objects.aget(id=run.id)
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert refreshed.status == "terminated"
    assert refreshed.lifecycle_state == "exited"
    assert refreshed.ended_at is not None
    assert [event.event_type for event in events] == ["thread.session-stopped"]


@pytest.mark.asyncio
async def test_stop_contains_registry_owner_even_if_durable_row_was_cascaded(
    monkeypatch,
):
    orphan_id = "chat-cascaded-owner"
    runtime = object()
    removed: list[str] = []
    cleaned: list[str] = []

    monkeypatch.setattr(
        service.runtime_registry,
        "get",
        lambda run_id: runtime if run_id == orphan_id else KeyError(run_id),
    )

    async def fake_remove(run_id):
        removed.append(run_id)

    monkeypatch.setattr(service.runtime_registry, "remove", fake_remove)
    monkeypatch.setattr(
        service.documents_watch,
        "stop_watch",
        lambda run_id: cleaned.append(f"watch:{run_id}"),
    )
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda run_id: cleaned.append(f"artifacts:{run_id}"),
    )

    assert await service.chat_session.stop(orphan_id) is True
    assert removed == [orphan_id]
    assert cleaned == [f"watch:{orphan_id}", f"artifacts:{orphan_id}"]


@pytest.mark.asyncio
async def test_failed_runtime_containment_does_not_publish_false_stopped_state(
    monkeypatch,
    tmp_path,
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-stop-retry-project",
        module_id="chat-stop-retry-module",
        task_id="chat-stop-retry-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-stop-retry",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-stop-retry",
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="turn-stop-retry",
    )
    runtime = object()
    remove_attempts = 0

    def fake_get(_run_id):
        return runtime

    async def flaky_remove(_run_id):
        nonlocal remove_attempts
        remove_attempts += 1
        if remove_attempts == 1:
            raise RuntimeError("containment failed")

    async def fake_publish(*_args):
        return None

    monkeypatch.setattr(service.runtime_registry, "get", fake_get)
    monkeypatch.setattr(service.runtime_registry, "remove", flaky_remove)
    monkeypatch.setattr(service, "publish_status", fake_publish)
    monkeypatch.setattr(service.documents_watch, "stop_watch", lambda _run_id: None)
    monkeypatch.setattr(
        service,
        "cleanup_temporary_artifacts_for_run",
        lambda _run_id: None,
    )

    with pytest.raises(RuntimeError, match="containment failed"):
        await service.chat_session.stop(run.id)

    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert run.status == "running"
    assert session.status == AgentChatSession.Status.RUNNING
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert events == []

    assert await service.chat_session.stop(run.id) is True
    await run.arefresh_from_db()
    session = await AgentChatSession.objects.aget(run=run)
    assert run.status == "terminated"
    assert session.status == AgentChatSession.Status.STOPPED
    assert remove_attempts == 2


@pytest.mark.asyncio
async def test_start_turn_command_id_is_durable_and_replay_does_not_duplicate(
    monkeypatch, tmp_path
):
    issue = await sync_to_async(ensure_issue, thread_sensitive=True)(
        project_id="chat-command-project",
        module_id="chat-command-module",
        task_id="chat-command-task",
    )
    run = await AgentRun.objects.acreate(
        id="chat-command-dedupe",
        issue_id=issue.id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        cwd=str(tmp_path),
        lifecycle_state="quiet",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(
        run=run,
        provider_thread_id="provider-thread-command",
        status=AgentChatSession.Status.READY,
    )
    calls = []

    class FakeRuntime:
        active_turn_id = None

        async def send_turn(self, prompt, *, client_message_id=None):
            calls.append((prompt, client_message_id))
            self.active_turn_id = "turn-command"
            return "turn-command"

    runtime = FakeRuntime()
    monkeypatch.setattr(service.runtime_registry, "get", lambda run_id: runtime)

    first = await service.chat_session.send_turn(
        run.id,
        "Inspect",
        command_id="ws-command-1",
    )
    second = await service.chat_session.send_turn(
        run.id,
        "Inspect",
        command_id="ws-command-1",
    )
    with pytest.raises(service.ChatRunError) as conflict:
        await service.chat_session.send_turn(
            run.id,
            "Different prompt",
            command_id="ws-command-1",
        )

    assert first == second == "turn-command"
    assert conflict.value.code == "command_id_conflict"
    assert calls == [("Inspect", "ws-command-1")]
    command = await AgentChatCommand.objects.aget(
        session_id=run.id,
        command_id="ws-command-1",
    )
    assert command.status == AgentChatCommand.Status.COMPLETED
    assert command.result == {"turn_id": "turn-command"}
    assert command.request_fingerprint is not None
