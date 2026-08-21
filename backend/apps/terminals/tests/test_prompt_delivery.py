"""Observable launch-message delivery and failure outcomes."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

import apps.terminals.launch as launch
import apps.terminals.tmux.input as tmux_input
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from apps.terminals.prompt_delivery import stage_resume_prompt, submit_entry_skill
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
)
from apps.terminals.tests.fakes import FakeAdapter, patch_terminal_runtime
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


async def test_entry_skill_waits_for_readiness_and_submits_once() -> None:
    runtime = InMemoryTerminalRuntime()
    run_id = "delivery-run"
    runtime.create(
        CreateTerminal(
            agent_run_id=run_id,
            command="provider",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )

    checks = 0

    def ready(screen: bytes) -> bool:
        nonlocal checks
        checks += 1
        if checks == 2:
            runtime.feed_output(run_id, b"ready")
        return b"ready" in screen

    await submit_entry_skill(
        runtime=runtime,
        agent_run_id=run_id,
        command="/implement",
        is_ready=ready,
        timeout=1,
        poll_interval=0,
    )

    assert checks == 3
    assert runtime.submitted_text(run_id) == ("/implement",)


async def test_resume_delivery_stages_continue_without_submitting() -> None:
    runtime = InMemoryTerminalRuntime()
    run_id = "resume-delivery-run"
    runtime.create(
        CreateTerminal(
            agent_run_id=run_id,
            command="provider --resume conversation",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(columns=80, rows=24),
        )
    )
    runtime.feed_output(run_id, b"ready")

    await stage_resume_prompt(
        runtime=runtime,
        agent_run_id=run_id,
        prompt="continue",
        is_ready=lambda screen: b"ready" in screen,
        timeout=1,
        poll_interval=0,
    )

    assert runtime.staged_text(run_id) == ("continue",)
    assert runtime.submitted_text(run_id) == ()


@pytest.mark.parametrize(
    ("provider", "screen"),
    [
        ("claude", b"\x1b[32m\xe2\x9d\xaf\x1b[0m "),
        ("agy", b"> you: "),
        ("codex", "› Ask Codex to do anything".encode()),
        ("gemini", b"> Type your message or @path/to/file"),
    ],
)
def test_each_provider_declares_its_ready_marker(provider: str, screen: bytes) -> None:
    from apps.terminals.agents.registry import get_adapter

    assert get_adapter(provider).is_prompt_ready(screen)


def test_codex_startup_prompt_is_not_mistaken_for_ready_composer() -> None:
    from apps.terminals.agents.registry import get_adapter

    assert not get_adapter("codex").is_prompt_ready(
        "› Selected workflow prompt:\n  Start the task".encode()
    )


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
async def test_each_provider_launches_with_full_prompt_then_submits_entry_skill(
    provider: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = patch_terminal_runtime(monkeypatch)
    run_id = f"{provider}-delivery"
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)

    async def ignore_status(*args, **kwargs):
        return None

    monkeypatch.setattr(launch, "publish_status", ignore_status)
    prompt = "complete prompt body"
    entry_skill = f"/{provider}-entry"

    await launch._launch(
        adapter=FakeAdapter(slug=provider),
        issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
        argv=[provider, prompt],
        cwd="/tmp",
        design_dir=None,
        scope="task",
        doc_rel_path=None,
        agent_run_id=run_id,
        initial_prompt=prompt,
        submitted_prompt=entry_skill,
    )

    assert prompt in runtime.requests[0].command
    assert runtime.submitted == [(run_id, entry_skill)]
    persisted = await AgentRun.objects.aget(id=run_id)
    assert persisted.initial_prompt == prompt


async def test_launch_without_entry_skill_never_types_the_full_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = patch_terminal_runtime(monkeypatch)
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)

    async def ignore_status(*args, **kwargs):
        return None

    monkeypatch.setattr(launch, "publish_status", ignore_status)
    prompt = "complete prompt body"

    await launch._launch(
        adapter=FakeAdapter(slug="codex"),
        issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
        argv=["codex", prompt],
        cwd="/tmp",
        design_dir=None,
        scope="task",
        doc_rel_path=None,
        agent_run_id="no-entry-skill",
        initial_prompt=prompt,
    )

    assert prompt in runtime.requests[0].command
    assert runtime.submitted == []


async def test_readiness_timeout_records_failure_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = patch_terminal_runtime(monkeypatch)
    runtime.screens["timeout-run"] = b"provider booted without a composer"
    monkeypatch.setattr(launch, "PROMPT_READINESS_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(launch.documents_watch, "start_watch", lambda **kwargs: None)

    with pytest.raises(launch.PromptDeliveryFailed) as raised:
        await launch._launch(
            adapter=FakeAdapter(slug="claude"),
            issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
            argv=["claude"],
            cwd="/tmp",
            design_dir=None,
            scope="task",
            doc_rel_path=None,
            agent_run_id="timeout-run",
            initial_prompt="start the task",
            submitted_prompt="/to-spec",
        )

    assert raised.value.as_payload() == {
        "detail": "prompt_delivery_failed",
        "code": "prompt_delivery_failed",
        "reason": "readiness_timeout",
    }
    run = await AgentRun.objects.aget(id="timeout-run")
    session = await AgentTerminalSession.objects.aget(agent_run_id="timeout-run")
    assert (run.status, run.lifecycle_state, run.error) == (
        "error",
        "error",
        "prompt_delivery_failed",
    )
    assert run.ended_at is not None
    assert session.terminated_at is not None
    assert runtime.terminated == ["timeout-run"]
    assert runtime.submitted == []


@dataclass
class _Result:
    returncode: int = 0
    stdout: list[str] | None = None
    stderr: list[str] | None = None


def test_oversized_tmux_message_uses_file_backed_buffer_intact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompt = "large prompt line\n" * 1_000
    commands: list[tuple[str, ...]] = []
    loaded: list[bytes] = []

    class Server:
        def cmd(self, *args: str) -> _Result:
            commands.append(args)
            if args[0] == "load-buffer":
                with open(args[-1], "rb") as handle:
                    loaded.append(handle.read())
            if args[0] == "capture-pane":
                return _Result(stdout=prompt.splitlines())
            return _Result()

    monkeypatch.setattr(tmux_input, "_server", Server)
    monkeypatch.setattr(tmux_input.time, "sleep", lambda _: None)

    tmux_input.submit_text("large-run", prompt)

    assert loaded == [prompt.encode()]
    assert [command[0] for command in commands] == [
        "load-buffer",
        "paste-buffer",
        "capture-pane",
        "send-keys",
        "send-keys",
    ]
    assert {"-p", "-r"}.issubset(commands[1])
    assert commands[-1][-1] == "Enter"


def test_tmux_uses_bracketed_paste_before_pressing_enter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompt = "/to-tickets story\ncontext"
    commands: list[tuple[str, ...]] = []
    captures = iter(([], [prompt]))
    explicit_paste = False
    enter_count = 0
    submitted = False

    class Server:
        def cmd(self, *args: str) -> _Result:
            nonlocal enter_count, explicit_paste, submitted
            commands.append(args)
            if args[0] == "paste-buffer":
                explicit_paste = "-p" in args and "-r" in args
            if args[0] == "capture-pane":
                rendered = next(captures)
                return _Result(stdout=[f"  {line}" for line in rendered])
            if args[0] == "send-keys" and args[-1] == "Enter":
                enter_count += 1
                # The first Enter accepts a provider's skill completion. The
                # second submits the completed invocation.
                submitted = explicit_paste and enter_count == 2
            return _Result()

    monkeypatch.setattr(tmux_input, "_server", Server)
    monkeypatch.setattr(tmux_input.time, "sleep", lambda _: None)

    tmux_input.submit_text("slash-command-run", prompt)

    assert [command[0] for command in commands] == [
        "set-buffer",
        "paste-buffer",
        "capture-pane",
        "capture-pane",
        "send-keys",
        "send-keys",
    ]
    assert {"-p", "-r"}.issubset(commands[1])
    assert commands[-1][-1] == "Enter"
    assert enter_count == 2
    assert submitted


def test_tmux_can_stage_text_without_pressing_enter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands: list[tuple[str, ...]] = []

    class Server:
        def cmd(self, *args: str) -> _Result:
            commands.append(args)
            if args[0] == "capture-pane":
                return _Result(stdout=["> continue"])
            return _Result()

    monkeypatch.setattr(tmux_input, "_server", Server)

    tmux_input.stage_text("resume-run", "continue")

    assert [command[0] for command in commands] == [
        "set-buffer",
        "paste-buffer",
        "capture-pane",
    ]
    assert all(command[0] != "send-keys" for command in commands)
