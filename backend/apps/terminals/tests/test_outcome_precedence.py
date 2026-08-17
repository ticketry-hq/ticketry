"""Terminal outcomes outrank the output-inactivity overlay (#663).

Every case here asserts the public status contract — the authoritative run
record and the effective projection read from it — with an injected clock, so
the precedence rule is observable exactly as a client observes it:

1. explicit termination or confirmed hosted-command exit projects ``exited``;
2. the authoritative missing-session outcome keeps its terminal treatment;
3. otherwise a live run past the unchanged-output deadline projects ``stalled``;
4. otherwise the latest provider lifecycle state is presented.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from asgiref.sync import sync_to_async

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.terminals import launch as launch_module
from apps.terminals.launch import terminate_agent_run
from apps.terminals.models import AgentTerminalSession
from apps.terminals.output_activity import observation, record_terminal_output
from apps.terminals.persistence import LaunchRecords, persist_launch
from apps.terminals.reconciliation import TerminalReconciler
from apps.terminals.runtime import (
    CreateTerminal,
    InMemoryTerminalRuntime,
    TerminalDimensions,
)
from studio_server.contracts import (
    STALL_AFTER_SECONDS,
    LifecycleEvent,
    project_effective_state,
)
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)

CREATED_AT = "2026-08-15T12:00:00+00:00"
NAMESPACE = "memory"


@pytest.fixture
def runtime(monkeypatch):
    """One fake terminal runtime shared by launch, termination, and reconcile."""

    fake = InMemoryTerminalRuntime(namespace=NAMESPACE)
    monkeypatch.setattr(launch_module, "terminal_runtime", fake)
    return fake


@pytest.fixture
def published(monkeypatch):
    frames: list[tuple[str, dict]] = []

    async def capture(project_id: str, frame: dict) -> None:
        frames.append((project_id, frame))

    monkeypatch.setattr(observation, "publish_status", capture)
    return frames


def _launch(runtime, agent_run_id: str) -> str:
    """Create one run, its durable mirror, and its fake pane."""

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
            runtime_namespace=NAMESPACE,
        )
    )
    runtime.create(
        CreateTerminal(
            agent_run_id=agent_run_id,
            command="codex",
            working_directory="/tmp",
            environment={},
            dimensions=TerminalDimensions(80, 24),
        )
    )
    return routing.project_id


async def _alaunch(runtime, agent_run_id: str) -> str:
    return await sync_to_async(_launch, thread_sensitive=True)(runtime, agent_run_id)


async def _record(project_id: str, agent_run_id: str):
    records = await dao.agent_status_records(project_id, runtime_namespace=NAMESPACE)
    return next(r for r in records if r.agent_run_id == agent_run_id)


def _long_after(record) -> datetime:
    """A clock far past the unchanged-output deadline for this record."""

    observed = datetime.fromisoformat(record.last_output_at or CREATED_AT)
    return observed + timedelta(seconds=STALL_AFTER_SECONDS * 10)


def _effective(record, at: datetime) -> str:
    return project_effective_state(
        state=record.state, last_output_at=record.last_output_at, now=at
    )


@pytest.mark.asyncio
async def test_explicit_termination_projects_exited_past_the_deadline(runtime):
    project_id = await _alaunch(runtime, "run-terminated")

    await sync_to_async(terminate_agent_run, thread_sensitive=True)("run-terminated")

    record = await _record(project_id, "run-terminated")
    assert record.state == "exited"
    # The overlay can never reach this run again: it has no deadline left.
    assert record.effective_state == "exited"
    assert _effective(record, _long_after(record)) == "exited"


@pytest.mark.asyncio
async def test_a_late_output_observation_cannot_resurrect_a_terminated_run(
    runtime, published
):
    project_id = await _alaunch(runtime, "run-late-output")
    await record_terminal_output("run-late-output", b"working\n")
    await sync_to_async(terminate_agent_run, thread_sensitive=True)("run-late-output")
    published.clear()

    # A capture that raced the ending arrives afterwards.
    assert await record_terminal_output("run-late-output", b"a later screen\n") is False

    assert published == []
    record = await _record(project_id, "run-late-output")
    assert record.state == "exited"
    assert _effective(record, _long_after(record)) == "exited"


@pytest.mark.asyncio
async def test_a_late_provider_hook_cannot_resurrect_a_terminated_run(runtime):
    project_id = await _alaunch(runtime, "run-late-hook")
    await sync_to_async(terminate_agent_run, thread_sensitive=True)("run-late-hook")

    # The provider's baked-in lifecycle URL outlives its terminal; the hook it
    # posts afterwards carries a timestamp newer than the ending.
    later = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    await dao.set_lifecycle_state("run-late-hook", "working", updated_at=later)

    run = await AgentRun.objects.aget(id="run-late-hook")
    assert run.lifecycle_state == "exited"
    record = await _record(project_id, "run-late-hook")
    assert record.state == "exited"
    assert _effective(record, _long_after(record)) == "exited"


@pytest.mark.asyncio
async def test_the_missing_session_outcome_keeps_its_terminal_treatment(runtime):
    project_id = await _alaunch(runtime, "run-missing")
    # The pane vanished from underneath the recorded run.
    runtime.terminate("run-missing")

    result = await sync_to_async(
        TerminalReconciler(runtime).reconcile, thread_sensitive=True
    )()

    assert result.soft_deleted == ["run-missing"]
    record = await _record(project_id, "run-missing")
    assert record.state == "exited"
    assert _effective(record, _long_after(record)) == "exited"
    # And the render-facing missing-session vocabulary is terminal in its own
    # right, ahead of the overlay.
    assert (
        project_effective_state(
            state="lost", last_output_at=CREATED_AT, now=datetime.now(timezone.utc)
        )
        == "lost"
    )


@pytest.mark.asyncio
async def test_ctrl_c_leaving_a_live_silent_pane_converges_to_stalled(runtime):
    """The interrupt did not kill the command; only its output stopped."""

    project_id = await _alaunch(runtime, "run-interrupted-live")
    await record_terminal_output("run-interrupted-live", b"^C\n")

    result = await sync_to_async(
        TerminalReconciler(runtime).reconcile, thread_sensitive=True
    )()
    assert result.running == ["run-interrupted-live"]

    record = await _record(project_id, "run-interrupted-live")
    observed = datetime.fromisoformat(record.last_output_at)
    assert record.state == "starting"
    assert (
        _effective(record, observed + timedelta(seconds=STALL_AFTER_SECONDS - 1))
        == "starting"
    )
    assert (
        _effective(record, observed + timedelta(seconds=STALL_AFTER_SECONDS))
        == "stalled"
    )


@pytest.mark.asyncio
async def test_ctrl_c_that_actually_ends_the_command_converges_to_exited(runtime):
    """The same silence, but the hosted command is confirmed dead."""

    project_id = await _alaunch(runtime, "run-interrupted-dead")
    await record_terminal_output("run-interrupted-dead", b"^C\n")
    runtime.finish("run-interrupted-dead", exit_code=130)

    result = await sync_to_async(
        TerminalReconciler(runtime).reconcile, thread_sensitive=True
    )()
    assert result.exited == ["run-interrupted-dead"]

    record = await _record(project_id, "run-interrupted-dead")
    assert record.state == "exited"
    # Runtime truth outranks the inactivity heuristic on both sides of the
    # boundary the live case above crossed into `stalled`.
    observed = datetime.fromisoformat(record.last_output_at)
    assert (
        _effective(record, observed + timedelta(seconds=STALL_AFTER_SECONDS))
        == "exited"
    )
    assert _effective(record, _long_after(record)) == "exited"


@pytest.mark.asyncio
async def test_a_reload_snapshot_reconstructs_the_same_state_on_both_sides(runtime):
    """A reconnect reads persisted facts, never a browser-local timer."""

    project_id = await _alaunch(runtime, "run-reloaded")
    await record_terminal_output("run-reloaded", b"still working\n")
    await dao.set_lifecycle_state(
        "run-reloaded", "working", updated_at="2026-08-15T12:00:05+00:00"
    )

    record = await _record(project_id, "run-reloaded")
    observed = datetime.fromisoformat(record.last_output_at)

    inside = await dao.agent_status_records(
        project_id,
        runtime_namespace=NAMESPACE,
        now=observed + timedelta(seconds=STALL_AFTER_SECONDS - 1),
    )
    outside = await dao.agent_status_records(
        project_id,
        runtime_namespace=NAMESPACE,
        now=observed + timedelta(seconds=STALL_AFTER_SECONDS),
    )

    inside_record = next(r for r in inside if r.agent_run_id == "run-reloaded")
    outside_record = next(r for r in outside if r.agent_run_id == "run-reloaded")
    assert inside_record.effective_state == "working"
    assert outside_record.effective_state == "stalled"
    # Both snapshots carry the same persisted facts; only the clock differs.
    assert inside_record.state == outside_record.state == "working"
    assert (
        inside_record.output_sequence == outside_record.output_sequence == 1
    )


@pytest.mark.asyncio
async def test_a_run_waiting_on_the_user_keeps_its_attention_state(runtime):
    """A waiting agent explains its own silence, so the overlay stays off it."""

    project_id = await _alaunch(runtime, "run-waiting")
    await record_terminal_output("run-waiting", b"which branch should I use?\n")
    await dao.set_lifecycle_state(
        "run-waiting", "needs_input", updated_at="2026-08-15T12:00:05+00:00"
    )

    record = await _record(project_id, "run-waiting")
    observed = datetime.fromisoformat(record.last_output_at)

    # A waiting terminal produces no output by definition, so without the
    # exemption this signal would be replaced by an idle one and never return.
    assert (
        _effective(record, observed + timedelta(seconds=STALL_AFTER_SECONDS))
        == "needs_input"
    )
    assert _effective(record, _long_after(record)) == "needs_input"

    # A pending permission decision is silent for the same reason.
    await dao.set_lifecycle_state(
        "run-waiting", "permission_required", updated_at="2026-08-15T12:00:06+00:00"
    )
    reread = await _record(project_id, "run-waiting")
    assert _effective(reread, _long_after(reread)) == "permission_required"

    # The reload path reconstructs the same answer past the boundary.
    outside = await dao.agent_status_records(
        project_id,
        runtime_namespace=NAMESPACE,
        now=observed + timedelta(seconds=STALL_AFTER_SECONDS * 10),
    )
    outside_record = next(r for r in outside if r.agent_run_id == "run-waiting")
    assert outside_record.effective_state == "permission_required"


@pytest.mark.asyncio
async def test_a_terminated_run_reloads_as_exited_on_both_sides(runtime):
    project_id = await _alaunch(runtime, "run-reloaded-dead")
    await record_terminal_output("run-reloaded-dead", b"working\n")
    session = await AgentTerminalSession.objects.aget(agent_run_id="run-reloaded-dead")
    observed = datetime.fromisoformat(session.last_output_at)
    await sync_to_async(terminate_agent_run, thread_sensitive=True)("run-reloaded-dead")

    for offset in (STALL_AFTER_SECONDS - 1, STALL_AFTER_SECONDS * 10):
        records = await dao.agent_status_records(
            project_id,
            runtime_namespace=NAMESPACE,
            now=observed + timedelta(seconds=offset),
        )
        record = next(r for r in records if r.agent_run_id == "run-reloaded-dead")
        assert record.effective_state == "exited"


@pytest.mark.asyncio
async def test_a_terminated_run_ignores_a_reduced_lifecycle_event(runtime):
    """The whole ingest path, not just the DAO, inherits the ended guard."""

    project_id = await _alaunch(runtime, "run-ingested-late")
    await sync_to_async(terminate_agent_run, thread_sensitive=True)("run-ingested-late")

    from apps.runs.api import ingest_lifecycle_event

    await ingest_lifecycle_event(
        LifecycleEvent(
            agent_run_id="run-ingested-late",
            agent="codex",
            kind="turn_start",
            ts=(datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        )
    )

    record = await _record(project_id, "run-ingested-late")
    assert record.state == "exited"
    assert _effective(record, _long_after(record)) == "exited"
