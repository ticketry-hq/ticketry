"""The native viewer's output reports at the shared boundary (#662).

Native rendering happens outside Ticketry, so these tests assert the one thing
that matters: the native adapter reaches the same application operation, with
the same observation contract, and produces the same run projection the browser
adapter produces. They observe persisted activity facts and published frames,
never the reporting transport's internals.
"""

from __future__ import annotations

import asyncio

import pytest
from asgiref.sync import sync_to_async

from apps.terminals import api as terminals_api
from apps.terminals import viewer_attachments
from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity import observation, report_native_output
from apps.terminals.output_activity.identity import output_identity
from apps.terminals.output_activity.native_reports import reset_native_reports
from apps.terminals.persistence import LaunchRecords, persist_launch
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
    TerminalObservationError,
)
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)

CREATED_AT = "2026-08-09T12:00:00+00:00"


@pytest.fixture(autouse=True)
def forget_reports():
    reset_native_reports()
    yield
    reset_native_reports()


@pytest.fixture
def published(monkeypatch):
    frames: list[tuple[str, dict]] = []

    async def capture(project_id: str, frame: dict) -> None:
        frames.append((project_id, frame))

    monkeypatch.setattr(observation, "publish_status", capture)
    return frames


@pytest.fixture
def runtime(monkeypatch) -> InMemoryTerminalRuntime:
    """The durable terminal the native renderer is showing someone."""

    fake = InMemoryTerminalRuntime()
    monkeypatch.setattr(viewer_attachments, "_runtime", fake)
    return fake


def _launch(agent_run_id: str) -> str:
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
            runtime_namespace="memory",
        )
    )
    return routing.project_id


async def _terminal(runtime: InMemoryTerminalRuntime, agent_run_id: str) -> str:
    project_id = await sync_to_async(_launch, thread_sensitive=True)(agent_run_id)
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
    return project_id


async def _session(agent_run_id: str) -> AgentTerminalSession:
    return await AgentTerminalSession.objects.aget(agent_run_id=agent_run_id)


@pytest.mark.asyncio
async def test_native_output_reports_through_the_shared_operation(
    runtime, published
):
    """Parity: the native report produces the browser adapter's projection."""

    project_id = await _terminal(runtime, "run-native")
    runtime.feed_output("run-native", b"codex is working\n")

    assert await report_native_output("run-native", interval_seconds=0) is True

    session = await _session("run-native")
    assert session.output_sequence == 1
    assert session.output_identity == output_identity(b"codex is working\n")
    assert session.last_output_at > CREATED_AT

    assert len(published) == 1
    frame_project_id, frame = published[0]
    assert frame_project_id == project_id
    assert frame["type"] == "terminal_activity"
    assert frame["run"]["agent_run_id"] == "run-native"
    assert frame["run"]["output_sequence"] == 1
    assert frame["run"]["last_output_at"] == session.last_output_at


@pytest.mark.asyncio
async def test_a_hidden_retained_viewer_keeps_reporting_changed_output(
    runtime, published
):
    """Navigating away hides a viewer; it does not stop its terminal."""

    await _terminal(runtime, "run-hidden")
    runtime.feed_output("run-hidden", b"first\n")
    assert await report_native_output("run-hidden", interval_seconds=0) is True

    # The viewer is now retained but not visible. Its reports continue, and
    # changed output still advances the axis.
    runtime.feed_output("run-hidden", b"second\n")
    assert await report_native_output("run-hidden", interval_seconds=0) is True

    assert (await _session("run-hidden")).output_sequence == 2
    assert [frame["run"]["output_sequence"] for _, frame in published] == [1, 2]


@pytest.mark.asyncio
async def test_unchanged_hydration_advances_neither_sequence_nor_deadline(
    runtime, published
):
    """A reconnect or reload redraw is not evidence that output changed."""

    await _terminal(runtime, "run-hydrated")
    runtime.feed_output("run-hydrated", b"unchanged screen\n")
    assert await report_native_output("run-hydrated", interval_seconds=0) is True
    first = await _session("run-hydrated")

    assert await report_native_output("run-hydrated", interval_seconds=0) is False
    assert await report_native_output("run-hydrated", interval_seconds=0) is False

    unchanged = await _session("run-hydrated")
    assert unchanged.output_sequence == first.output_sequence == 1
    assert unchanged.last_output_at == first.last_output_at
    assert len(published) == 1


@pytest.mark.asyncio
async def test_reports_coalesce_without_delaying_the_first_change(
    runtime, published
):
    """The first report is immediate; a burst behind it is one observation."""

    await _terminal(runtime, "run-coalesced")
    runtime.feed_output("run-coalesced", b"first\n")

    assert await report_native_output("run-coalesced", interval_seconds=60) is True

    # A second viewer of the same run, or an eager caller, is coalesced rather
    # than turned into another capture.
    runtime.feed_output("run-coalesced", b"second\n")
    assert await report_native_output("run-coalesced", interval_seconds=60) is False
    assert (await _session("run-coalesced")).output_sequence == 1

    # The newest screen is still what the next observation stores.
    assert await report_native_output("run-coalesced", interval_seconds=0) is True
    session = await _session("run-coalesced")
    assert session.output_sequence == 2
    assert session.output_identity == output_identity(b"first\nsecond\n")


@pytest.mark.asyncio
async def test_an_ended_session_gains_no_activity_from_a_late_report(
    runtime, published
):
    await _terminal(runtime, "run-native-ended")
    runtime.feed_output("run-native-ended", b"late\n")
    await AgentTerminalSession.objects.filter(
        agent_run_id="run-native-ended"
    ).aupdate(terminated_at="2026-08-09T12:30:00+00:00")

    assert await report_native_output("run-native-ended", interval_seconds=0) is False

    assert (await _session("run-native-ended")).output_sequence == 0
    assert published == []


@pytest.mark.asyncio
async def test_a_failing_backend_never_raises_into_native_rendering(
    runtime, published, monkeypatch
):
    """A renderer asks for nothing back but "no"; it must never be broken."""

    await _terminal(runtime, "run-native-unhappy")

    def explode(agent_run_id: str) -> bytes:
        raise TerminalObservationError(agent_run_id)

    capture_screen = viewer_attachments.capture_screen
    monkeypatch.setattr(viewer_attachments, "capture_screen", explode)
    assert await report_native_output("run-native-unhappy", interval_seconds=0) is False

    async def fail_to_publish(project_id: str, frame: dict) -> None:
        raise RuntimeError("channel layer unavailable")

    monkeypatch.setattr(viewer_attachments, "capture_screen", capture_screen)
    monkeypatch.setattr(observation, "publish_status", fail_to_publish)
    runtime.feed_output("run-native-unhappy", b"output\n")
    assert await report_native_output("run-native-unhappy", interval_seconds=0) is False
    # The durable fact still advanced; only its announcement was lost.
    assert (await _session("run-native-unhappy")).output_sequence == 1

    # An unknown run is a miss, not an error.
    assert await report_native_output("run-never-launched", interval_seconds=0) is False


def test_the_application_operation_reports_one_viewer_observation(
    runtime, published, monkeypatch
):
    """The authenticated surface exposes exactly the shared observation."""

    _launch("run-native-api")
    runtime.create(
        CreateTerminal(
            agent_run_id="run-native-api",
            command="cat",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(80, 24),
        )
    )
    runtime.feed_output("run-native-api", b"native output\n")

    body = terminals_api.ViewerOutputReportBody(agent_run_id="run-native-api")
    assert terminals_api.report_viewer_output(body) == {
        "agent_run_id": "run-native-api",
        "observed": True,
    }
    assert (
        AgentTerminalSession.objects.get(
            agent_run_id="run-native-api"
        ).output_sequence
        == 1
    )
