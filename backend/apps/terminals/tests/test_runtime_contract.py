"""Shared contract tests for the fake and real tmux terminal runtimes."""

from __future__ import annotations

import ast
import logging
import shutil
import tempfile
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
    TerminalObservationError,
    TerminalState,
    TmuxTerminalRuntime,
)


_TMUX_AVAILABLE = shutil.which("tmux") is not None


@contextmanager
def _runtime(
    kind: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    command: str = "cat",
) -> Iterator[tuple[Any, str]]:
    agent_run_id = str(uuid.uuid4())
    if kind == "tmux":
        if not _TMUX_AVAILABLE:
            pytest.skip("tmux binary not on PATH")
        socket_root = tempfile.mkdtemp(
            prefix="ticketry-contract-tmux-", dir="/private/tmp"
        )
        monkeypatch.setenv("TMUX_TMPDIR", socket_root)
        monkeypatch.setenv("MUXED_TMUX_SOCKET", f"contract-{uuid.uuid4().hex[:12]}")
        runtime: Any = TmuxTerminalRuntime()
    else:
        runtime = InMemoryTerminalRuntime()
    runtime.create(
        CreateTerminal(
            agent_run_id=agent_run_id,
            command=command,
            working_directory="/tmp",
            environment={"TICKETRY_RUNTIME_CONTRACT": "1"},
            dimensions=TerminalDimensions(columns=90, rows=28),
        )
    )
    try:
        yield runtime, agent_run_id
    finally:
        runtime.terminate(agent_run_id)
        if kind == "tmux":
            shutil.rmtree(socket_root, ignore_errors=True)


@pytest.mark.parametrize("runtime_kind", ["memory", "tmux"])
def test_runtime_contract_durable_detach_raw_io_and_controls(
    runtime_kind: str,
    monkeypatch: pytest.MonkeyPatch,
):
    command = "sh -c 'stty -echo; while IFS= read -r line; do printf \"%s\\n\" \"$line\"; done'"
    with _runtime(runtime_kind, monkeypatch, command=command) as (runtime, run_id):
        assert runtime.inspect(run_id).state is TerminalState.RUNNING

        first = runtime.attach(run_id)
        first.write(b"contract-raw-io\n")
        output = b""
        for _ in range(4):
            output += first.read(4096)
            if b"contract-raw-io" in output:
                break
        assert b"contract-raw-io" in output
        first.resize(TerminalDimensions(columns=100, rows=32))
        first.scroll("up", 1)
        first.scroll("down", 1)
        first.detach()
        first.detach()
        assert first.completed is True
        assert first.wait() is None

        # Viewer detachment is transient; the durable hosted command survives.
        assert runtime.inspect(run_id).state is TerminalState.RUNNING
        second = runtime.attach(run_id)
        second.detach()
        assert runtime.inspect(run_id).state is TerminalState.RUNNING


@pytest.mark.parametrize("runtime_kind", ["memory", "tmux"])
def test_runtime_contract_retains_hosted_command_exit(
    runtime_kind: str,
    monkeypatch: pytest.MonkeyPatch,
):
    with _runtime(runtime_kind, monkeypatch, command="sh -c 'exit 7'") as (
        runtime,
        run_id,
    ):
        if isinstance(runtime, InMemoryTerminalRuntime):
            runtime.finish(run_id, exit_code=7)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            observation = runtime.inspect(run_id)
            if observation.state is TerminalState.EXITED:
                break
            time.sleep(0.02)
        else:
            pytest.fail("hosted command did not reach retained exited state")

        assert observation.exit_code == 7
        assert runtime.inspect(run_id) == observation


@pytest.mark.parametrize("runtime_kind", ["memory", "tmux"])
def test_runtime_contract_missing_and_absent_termination_are_distinct(
    runtime_kind: str,
    monkeypatch: pytest.MonkeyPatch,
):
    with _runtime(runtime_kind, monkeypatch) as (runtime, run_id):
        assert runtime.terminate(run_id).was_present is True
        assert runtime.inspect(run_id).state is TerminalState.MISSING
        assert runtime.terminate(run_id).was_present is False


@pytest.mark.parametrize("runtime_kind", ["memory", "tmux"])
def test_runtime_contract_reports_observation_failure(
    runtime_kind: str,
    monkeypatch: pytest.MonkeyPatch,
):
    with _runtime(runtime_kind, monkeypatch) as (runtime, run_id):
        if isinstance(runtime, InMemoryTerminalRuntime):
            runtime.fail_observation(run_id, OSError("inventory unavailable"))
            unavailable = runtime
        else:
            class BrokenServer:
                def cmd(self, *args):
                    raise OSError("inventory unavailable")

            unavailable = TmuxTerminalRuntime(_server_factory=BrokenServer)

        with pytest.raises(TerminalObservationError):
            unavailable.inspect(run_id)


def test_runtime_boundary_has_only_prepared_mechanical_create_inputs():
    assert list(CreateTerminal.__dataclass_fields__) == [
        "agent_run_id",
        "command",
        "working_directory",
        "environment",
        "dimensions",
    ]


def test_runtime_boundary_does_not_import_application_models_or_launch_policy():
    runtime_root = Path(__file__).parents[1] / "runtime"
    forbidden = (
        "django",
        "apps.runs",
        "apps.terminals.models",
        "apps.terminals.agents",
        "apps.terminals.launch",
        "apps.terminals.prompt_builder",
        "worktracker",
    )
    offenders: list[str] = []
    for source_path in runtime_root.glob("*.py"):
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            if any(name == prefix or name.startswith(f"{prefix}.") for name in names for prefix in forbidden):
                offenders.append(f"{source_path.name}:{node.lineno}")
    assert offenders == []


def test_tmux_runtime_logs_use_agent_run_id_not_internal_session_name(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.INFO, logger="apps.terminals.runtime._tmux")
    with _runtime("tmux", monkeypatch) as (_, run_id):
        messages = [record.getMessage() for record in caplog.records]
        assert any(run_id in message for message in messages)
        assert all(f"pt-{run_id}" not in message for message in messages)
