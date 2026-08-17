"""Viewer-independent observation of live terminal sessions (#679).

Asserts the durable outcome — which live sessions the sweep advances and which
it must leave alone — with no viewer attached anywhere in the test, because that
is exactly the production case the adapters cannot cover.
"""

from __future__ import annotations

import asyncio

import pytest
from asgiref.sync import sync_to_async

from apps.terminals import launch, viewer_attachments
from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity import live_sweep, observation
from apps.terminals.output_activity.live_sweep import (
    observe_live_sessions,
    start_live_output_sweep,
    stop_live_output_sweep,
    sweep_interval_seconds,
)
from apps.terminals.persistence import LaunchRecords, persist_launch
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
)
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)

CREATED_AT = "2026-08-09T12:00:00+00:00"


@pytest.fixture
def runtime(monkeypatch):
    """One in-memory runtime behind both the launch namespace and capture."""

    fake = InMemoryTerminalRuntime()
    monkeypatch.setattr(launch, "terminal_runtime", fake)
    monkeypatch.setattr(viewer_attachments, "_runtime", fake)
    return fake


@pytest.fixture
def published(monkeypatch):
    frames: list[tuple[str, dict]] = []

    async def capture(project_id: str, frame: dict) -> None:
        frames.append((project_id, frame))

    monkeypatch.setattr(observation, "publish_status", capture)
    return frames


def _launch(agent_run_id: str, *, runtime_namespace: str = "memory") -> str:
    routing = persist_launch(
        LaunchRecords(
            agent_run_id=agent_run_id,
            issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
            agent="codex",
            started_at=CREATED_AT,
            cwd="/tmp",
            design_dir=None,
            resumed_from=None,
            scope="task",
            doc_rel_path=None,
            runtime_namespace=runtime_namespace,
        )
    )
    return routing.project_id


async def _alaunch(agent_run_id: str, **kwargs) -> str:
    return await sync_to_async(_launch, thread_sensitive=True)(agent_run_id, **kwargs)


async def _asession(agent_run_id: str) -> AgentTerminalSession:
    return await AgentTerminalSession.objects.aget(agent_run_id=agent_run_id)


async def _create_terminal(runtime: InMemoryTerminalRuntime, agent_run_id: str) -> None:
    await asyncio.to_thread(
        runtime.create,
        CreateTerminal(
            agent_run_id=agent_run_id,
            command="cat",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(80, 24),
        ),
    )


@pytest.mark.asyncio
async def test_an_unwatched_live_session_still_gains_output_activity(
    runtime, published
):
    """No viewer is attached: the sweep is the only observer in this test."""

    project_id = await _alaunch("run-unwatched")
    await _create_terminal(runtime, "run-unwatched")
    runtime.feed_output("run-unwatched", b"working on it\n")

    assert await observe_live_sessions() == 1

    session = await _asession("run-unwatched")
    assert session.output_sequence == 1
    assert session.last_output_at > CREATED_AT
    assert [(pid, frame["run"]["agent_run_id"]) for pid, frame in published] == [
        (project_id, "run-unwatched")
    ]


@pytest.mark.asyncio
async def test_a_quiet_session_is_swept_without_extending_its_deadline(
    runtime, published
):
    await _alaunch("run-quiet")
    await _create_terminal(runtime, "run-quiet")
    runtime.feed_output("run-quiet", b"first\n")
    await observe_live_sessions()
    first = await _asession("run-quiet")

    # Repeated passes over an unchanged screen must not manufacture activity,
    # or nothing could ever project as stalled.
    assert await observe_live_sessions() == 0
    assert await observe_live_sessions() == 0

    unchanged = await _asession("run-quiet")
    assert unchanged.output_sequence == first.output_sequence == 1
    assert unchanged.last_output_at == first.last_output_at
    assert len(published) == 1


@pytest.mark.asyncio
async def test_the_sweep_skips_sessions_it_must_not_observe(runtime, published):
    await _alaunch("run-live")
    await _alaunch("run-terminated")
    await _alaunch("run-foreign", runtime_namespace="other-profile")
    for agent_run_id in ("run-live", "run-terminated", "run-foreign"):
        await _create_terminal(runtime, agent_run_id)
        runtime.feed_output(agent_run_id, b"output\n")
    await AgentTerminalSession.objects.filter(agent_run_id="run-terminated").aupdate(
        terminated_at="2026-08-09T12:30:00+00:00"
    )

    assert await observe_live_sessions() == 1

    assert (await _asession("run-live")).output_sequence == 1
    assert (await _asession("run-terminated")).output_sequence == 0
    # Another profile's socket is not ours to capture.
    assert (await _asession("run-foreign")).output_sequence == 0


@pytest.mark.asyncio
async def test_one_uncapturable_session_never_starves_the_rest(runtime, published):
    await _alaunch("run-missing-runtime")
    await _alaunch("run-healthy")
    # Only the healthy run has a runtime; capturing the other one raises.
    await _create_terminal(runtime, "run-healthy")
    runtime.feed_output("run-healthy", b"output\n")

    assert await observe_live_sessions() == 1
    assert (await _asession("run-healthy")).output_sequence == 1


@pytest.mark.asyncio
async def test_the_loop_observes_until_it_is_stopped(runtime, published, monkeypatch):
    monkeypatch.setenv("MUXED_OUTPUT_SWEEP_SECONDS", "0.01")
    await _alaunch("run-looped")
    await _create_terminal(runtime, "run-looped")
    runtime.feed_output("run-looped", b"first\n")

    await start_live_output_sweep()
    try:
        await _until(lambda session: session.output_sequence == 1, "run-looped")
        runtime.feed_output("run-looped", b"second\n")
        await _until(lambda session: session.output_sequence == 2, "run-looped")
    finally:
        await stop_live_output_sweep()

    runtime.feed_output("run-looped", b"third\n")
    await asyncio.sleep(0.05)
    assert (await _asession("run-looped")).output_sequence == 2


def test_the_sweep_can_be_disabled_by_configuration(monkeypatch):
    monkeypatch.delenv("MUXED_OUTPUT_SWEEP_SECONDS", raising=False)
    assert sweep_interval_seconds() == live_sweep.DEFAULT_SWEEP_INTERVAL_SECONDS

    monkeypatch.setenv("MUXED_OUTPUT_SWEEP_SECONDS", "0")
    assert sweep_interval_seconds() is None

    monkeypatch.setenv("MUXED_OUTPUT_SWEEP_SECONDS", "not-a-number")
    assert sweep_interval_seconds() is None


async def _until(predicate, agent_run_id: str, *, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate(await _asession(agent_run_id)):
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"the sweep never observed {agent_run_id} as expected")
