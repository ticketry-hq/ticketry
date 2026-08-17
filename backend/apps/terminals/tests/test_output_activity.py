"""Terminal-output activity at the shared application boundary (#661).

Asserts the public status contract — persisted identity/sequence/stamp and the
published projection — rather than hashing internals or ORM call order.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.terminals import viewer_attachments
from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity import (
    TerminalOutputObserver,
    observation,
    record_terminal_output,
)
from apps.terminals.output_activity.identity import output_identity
from apps.terminals.persistence import LaunchRecords, persist_launch
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
    TerminalObservationError,
)
from studio_server.contracts import project_effective_state
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)

CREATED_AT = "2026-08-09T12:00:00+00:00"


def _launch(
    agent_run_id: str,
    *,
    started_at: str = CREATED_AT,
    scope: str = "task",
    doc_rel_path: str | None = None,
) -> str:
    """Create one run and its durable terminal mirror; return the project id."""

    routing = persist_launch(
        LaunchRecords(
            agent_run_id=agent_run_id,
            issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
            agent="codex",
            started_at=started_at,
            cwd="/tmp",
            design_dir=None,
            resumed_from=None,
            scope=scope,
            doc_rel_path=doc_rel_path,
            runtime_namespace="memory",
        )
    )
    return routing.project_id


@pytest.fixture
def published(monkeypatch):
    frames: list[tuple[str, dict]] = []

    async def capture(project_id: str, frame: dict) -> None:
        frames.append((project_id, frame))

    monkeypatch.setattr(observation, "publish_status", capture)
    return frames


def _session(agent_run_id: str) -> AgentTerminalSession:
    return AgentTerminalSession.objects.get(agent_run_id=agent_run_id)


def test_new_session_starts_from_a_creation_time_inactivity_origin():
    _launch("run-baseline")

    session = _session("run-baseline")
    assert session.output_sequence == 0
    assert session.output_identity is None
    assert session.last_output_at == CREATED_AT


@pytest.mark.asyncio
async def test_first_output_advances_the_axis_and_publishes_the_projection(
    published,
):
    project_id = await _alaunch("run-first")

    assert await record_terminal_output("run-first", b"$ codex\n") is True

    session = await _asession("run-first")
    assert session.output_sequence == 1
    assert session.output_identity == output_identity(b"$ codex\n")
    # The stamp is the backend's, not the reporting adapter's, so it must have
    # moved past the creation baseline.
    assert session.last_output_at > CREATED_AT

    assert len(published) == 1
    frame_project_id, frame = published[0]
    assert frame_project_id == project_id
    assert frame["type"] == "terminal_activity"
    assert frame["run"]["agent_run_id"] == "run-first"
    assert frame["run"]["output_sequence"] == 1
    assert frame["run"]["last_output_at"] == session.last_output_at
    # The lifecycle axis travels untouched alongside it.
    assert frame["run"]["state"] == "starting"


@pytest.mark.asyncio
async def test_doc_chat_output_advances_the_axis_without_publishing(published):
    # The status snapshot, the lifecycle delta and the recovery frame all omit
    # doc-chat runs, so an activity frame here would seed the client with a run
    # the next snapshot retires as a phantom exited row.
    from asgiref.sync import sync_to_async

    await sync_to_async(_launch, thread_sensitive=True)(
        "run-docchat", scope="docchat", doc_rel_path="docs/notes.md"
    )

    assert await record_terminal_output("run-docchat", b"$ codex\n") is True

    session = await _asession("run-docchat")
    assert session.output_sequence == 1
    assert session.output_identity == output_identity(b"$ codex\n")
    assert session.last_output_at > CREATED_AT
    assert published == []


@pytest.mark.asyncio
async def test_unchanged_output_is_idempotent_and_extends_nothing(published):
    await _alaunch("run-duplicate")
    await record_terminal_output("run-duplicate", b"same screen")
    first = await _asession("run-duplicate")

    # A reconnect redraw of an unchanged screen digests identically.
    assert await record_terminal_output("run-duplicate", b"same screen") is False
    assert await record_terminal_output("run-duplicate", b"same screen") is False

    unchanged = await _asession("run-duplicate")
    assert unchanged.output_sequence == first.output_sequence == 1
    assert unchanged.last_output_at == first.last_output_at
    assert len(published) == 1


@pytest.mark.asyncio
async def test_changed_output_advances_monotonically(published):
    await _alaunch("run-changed")

    for index, screen in enumerate((b"one", b"two", b"three"), start=1):
        assert await record_terminal_output("run-changed", screen) is True
        assert (await _asession("run-changed")).output_sequence == index

    assert [frame["run"]["output_sequence"] for _, frame in published] == [1, 2, 3]


@pytest.mark.asyncio
async def test_an_ended_session_cannot_gain_output_activity(published):
    await _alaunch("run-ended")
    await AgentTerminalSession.objects.filter(agent_run_id="run-ended").aupdate(
        terminated_at="2026-08-09T12:30:00+00:00"
    )

    assert await record_terminal_output("run-ended", b"late output") is False

    session = await _asession("run-ended")
    assert session.output_sequence == 0
    assert session.output_identity is None
    assert published == []


@pytest.mark.asyncio
async def test_a_failed_publication_never_fails_the_observation(monkeypatch):
    await _alaunch("run-publish-failure")

    async def explode(project_id: str, frame: dict) -> None:
        raise RuntimeError("channel layer unavailable")

    monkeypatch.setattr(observation, "publish_status", explode)

    # The caller is a byte pump: it must be told nothing worse than "no".
    assert await record_terminal_output("run-publish-failure", b"output") is False
    # The durable fact still advanced; only its announcement was lost.
    assert (await _asession("run-publish-failure")).output_sequence == 1


@pytest.mark.asyncio
async def test_a_failed_write_never_raises_into_the_byte_stream(monkeypatch):
    async def explode(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(observation, "advance_output_identity", explode)

    assert await record_terminal_output("run-missing", b"output") is False


@pytest.mark.asyncio
async def test_snapshot_projects_stalled_at_the_inclusive_boundary(published):
    project_id = await _alaunch("run-boundary")
    await record_terminal_output("run-boundary", b"working")
    session = await _asession("run-boundary")
    observed = datetime.fromisoformat(session.last_output_at)

    records = await dao.agent_status_records(project_id, runtime_namespace="memory")
    record = next(r for r in records if r.agent_run_id == "run-boundary")

    just_inside = observed + timedelta(seconds=59, milliseconds=999)
    at_boundary = observed + timedelta(seconds=60)
    assert (
        project_effective_state(
            state=record.state, last_output_at=record.last_output_at, now=just_inside
        )
        == "starting"
    )
    assert (
        project_effective_state(
            state=record.state, last_output_at=record.last_output_at, now=at_boundary
        )
        == "stalled"
    )
    # The overlay is a projection only: the persisted lifecycle record is
    # untouched by the passage of time.
    run = await AgentRun.objects.aget(id="run-boundary")
    assert run.lifecycle_state == "starting"


@pytest.mark.asyncio
async def test_a_terminal_outcome_outranks_the_inactivity_overlay():
    long_ago = (
        datetime.now(timezone.utc) - timedelta(minutes=5)
    ).isoformat()
    assert (
        project_effective_state(state="exited", last_output_at=long_ago) == "exited"
    )
    assert project_effective_state(state="lost", last_output_at=long_ago) == "lost"


@pytest.mark.asyncio
async def test_browser_stream_observations_report_through_the_shared_operation(
    published, monkeypatch
):
    """The browser byte pump's observer feeds the one activity operation."""

    runtime = InMemoryTerminalRuntime()
    monkeypatch.setattr(viewer_attachments, "_runtime", runtime)
    await _alaunch("run-streamed")
    await asyncio.to_thread(
        runtime.create,
        CreateTerminal(
            agent_run_id="run-streamed",
            command="cat",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(80, 24),
        ),
    )

    observer = TerminalOutputObserver("run-streamed", interval_seconds=0)
    observer.start()
    try:
        runtime.feed_output("run-streamed", b"first line\n")
        observer.note_output()
        await _until(lambda session: session.output_sequence == 1, "run-streamed")

        # A redraw that renders the same screen must not extend the deadline.
        observer.note_output()
        await asyncio.sleep(0.05)
        assert (await _asession("run-streamed")).output_sequence == 1

        runtime.feed_output("run-streamed", b"second line\n")
        observer.note_output()
        await _until(lambda session: session.output_sequence == 2, "run-streamed")
    finally:
        observer.close()

    assert [frame["run"]["output_sequence"] for _, frame in published] == [1, 2]


@pytest.mark.asyncio
async def test_a_failed_capture_leaves_the_stream_untouched(published, monkeypatch):
    """A runtime that cannot be captured is a silent status miss, not an error."""

    await _alaunch("run-uncapturable")

    def explode(agent_run_id: str) -> bytes:
        raise TerminalObservationError(agent_run_id)

    monkeypatch.setattr(viewer_attachments, "capture_screen", explode)
    observer = TerminalOutputObserver("run-uncapturable", interval_seconds=0)
    observer.start()
    try:
        observer.note_output()
        await asyncio.sleep(0.05)
    finally:
        observer.close()

    assert (await _asession("run-uncapturable")).output_sequence == 0
    assert published == []


async def _until(predicate, agent_run_id: str, *, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate(await _asession(agent_run_id)):
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"activity never satisfied the expectation for {agent_run_id}")


# Async wrappers: `persist_launch` and the ORM reads are synchronous, and the
# operation under test is async.
async def _alaunch(agent_run_id: str) -> str:
    from asgiref.sync import sync_to_async

    return await sync_to_async(_launch, thread_sensitive=True)(agent_run_id)


async def _asession(agent_run_id: str) -> AgentTerminalSession:
    return await AgentTerminalSession.objects.aget(agent_run_id=agent_run_id)
