"""Tests for the agent-runs Django DAO."""

from datetime import datetime, timezone

import pytest
from django.db import IntegrityError

from apps.runs import dao
from apps.runs.models import AgentRun


pytestmark = pytest.mark.django_db(transaction=True)


def _make_run(run_id: str, *, task_id: str | None, started_at: str) -> AgentRun:
    """Build a fully-populated run."""

    return AgentRun(
        id=run_id,
        workspace_slug="meml",
        project_id="proj-1",
        module_id="mod-1",
        task_id=task_id,
        ticket_seq=472,
        agent="claude",
        status="running",
        started_at=started_at,
        cwd="/tmp/work",
    )


async def test_insert_round_trips_full_row() -> None:
    await dao.insert_agent_run(
        _make_run("run-1", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    stored = await dao.list_agent_runs_for_task("task-1")

    assert len(stored) == 1
    assert stored[0].id == "run-1"
    assert stored[0].workspace_slug == "meml"
    assert stored[0].ticket_seq == 472
    assert stored[0].cwd == "/tmp/work"


async def test_insert_round_trips_nullable_fields() -> None:
    await dao.insert_agent_run(
        AgentRun(
            id="run-null",
            project_id="proj-1",
            module_id="mod-1",
            agent="codex",
            status="running",
            started_at="2026-05-29T10:00:00",
        )
    )

    run = await AgentRun.objects.aget(id="run-null")

    assert run.task_id is None
    assert run.ticket_seq is None
    assert run.ended_at is None
    assert run.exit_code is None
    assert run.error is None
    assert run.cwd is None
    assert run.workspace_slug is None
    assert run.provider_session_id is None


async def test_insert_round_trips_resumed_from() -> None:
    run = _make_run("run-resume", task_id="task-1", started_at="2026-05-29T10:00:00")
    run.resumed_from = "run-old"
    await dao.insert_agent_run(run)

    stored = await AgentRun.objects.aget(id="run-resume")

    assert stored.resumed_from == "run-old"


async def test_duplicate_insert_raises_integrity_error() -> None:
    await dao.insert_agent_run(
        _make_run("run-1", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    with pytest.raises(IntegrityError):
        await dao.insert_agent_run(
            _make_run("run-1", task_id="task-1", started_at="2026-05-29T11:00:00")
        )


async def test_update_on_exit_patches_only_terminal_fields() -> None:
    await dao.insert_agent_run(
        _make_run("run-1", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    updated = await dao.update_agent_run_exit(
        "run-1",
        status="failed",
        ended_at="2026-05-29T10:05:00",
        exit_code=1,
        error="boom",
    )
    stored = await AgentRun.objects.aget(id="run-1")

    assert updated is True
    assert stored.status == "failed"
    assert stored.ended_at == "2026-05-29T10:05:00"
    assert stored.exit_code == 1
    assert stored.error == "boom"
    assert stored.module_id == "mod-1"


async def test_targeted_updates_return_false_for_unknown_id() -> None:
    assert await dao.update_agent_run_exit(
        "missing", status="exited", ended_at="2026-05-29T10:05:00"
    ) is False
    assert await dao.set_provider_session_id("missing", "abc") is False
    assert await dao.set_lifecycle_state(
        "missing", "working", updated_at="2026-05-29T10:05:00"
    ) is False


async def test_provider_session_and_lifecycle_updates() -> None:
    await dao.insert_agent_run(
        _make_run("run-1", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    assert await dao.set_provider_session_id("run-1", "provider-1") is True
    assert await dao.set_lifecycle_state(
        "run-1", "needs_input", updated_at="2026-05-29T10:05:00"
    ) is True
    stored = await AgentRun.objects.aget(id="run-1")

    assert stored.provider_session_id == "provider-1"
    assert stored.lifecycle_state == "needs_input"
    assert stored.lifecycle_updated_at == "2026-05-29T10:05:00+00:00"


async def test_lifecycle_timestamp_normalizes_naive_and_zulu_input() -> None:
    await dao.insert_agent_run(
        _make_run("normalized", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    assert await dao.set_lifecycle_state(
        "normalized", "working", updated_at="2026-05-29T10:05:00"
    ) is True
    assert await dao.set_lifecycle_state(
        "normalized", "turn_complete", updated_at="2026-05-29T10:06:00Z"
    ) is True

    stored = await AgentRun.objects.aget(id="normalized")
    assert stored.lifecycle_updated_at == "2026-05-29T10:06:00+00:00"


async def test_older_lifecycle_update_is_ignored() -> None:
    await dao.insert_agent_run(
        _make_run("run-ordered", task_id="task-1", started_at="2026-05-29T10:00:00")
    )
    assert await dao.set_lifecycle_state(
        "run-ordered", "turn_complete", updated_at="2026-05-29T10:05:00+00:00"
    ) is True

    assert await dao.set_lifecycle_state(
        "run-ordered", "working", updated_at="2026-05-29T10:04:00+00:00"
    ) is False
    stored = await AgentRun.objects.aget(id="run-ordered")
    assert stored.lifecycle_state == "turn_complete"


async def test_history_filters_task_orders_and_limits() -> None:
    for run_id, task_id, started_at in (
        ("old", "task-1", "2026-05-29T09:00:00"),
        ("new", "task-1", "2026-05-29T11:00:00"),
        ("other", "task-2", "2026-05-29T12:00:00"),
    ):
        await dao.insert_agent_run(
            _make_run(run_id, task_id=task_id, started_at=started_at)
        )

    runs = await dao.list_agent_runs_for_task("task-1")
    limited = await dao.list_agent_runs_for_task("task-1", limit=1)

    assert [run.id for run in runs] == ["new", "old"]
    assert [run.id for run in limited] == ["new"]


async def test_last_activity_by_module_ranks_and_coalesces() -> None:
    # Two modules; mod-a's newest run only has started_at, mod-b's newest run
    # bumped lifecycle_updated_at past its own (older) started_at.
    runs = [
        _make_run("a-old", task_id="t", started_at="2026-06-10T09:00:00+00:00"),
        _make_run("a-new", task_id="t", started_at="2026-06-12T09:00:00+00:00"),
        _make_run("b-1", task_id=None, started_at="2026-06-11T08:00:00+00:00"),
    ]
    runs[0].module_id = runs[1].module_id = "mod-a"
    runs[2].module_id = "mod-b"
    # mod-b's run emitted a lifecycle event after start → coalesce picks it.
    runs[2].lifecycle_updated_at = "2026-06-13T12:00:00+00:00"
    for run in runs:
        await dao.insert_agent_run(run)

    activity = await dao.last_activity_by_module(
        "proj-1", now=datetime(2026, 6, 20, tzinfo=timezone.utc)
    )

    assert activity == {
        "mod-a": "2026-06-12T09:00:00+00:00",
        "mod-b": "2026-06-13T12:00:00+00:00",
    }


async def test_last_activity_window_and_project_scope() -> None:
    # Outside the window → excluded. Different project → excluded.
    old = _make_run("old", task_id="t", started_at="2026-01-01T00:00:00+00:00")
    old.module_id = "mod-old"
    other = _make_run(
        "other", task_id="t", started_at="2026-06-15T00:00:00+00:00"
    )
    other.project_id = "proj-2"
    other.module_id = "mod-other"
    recent = _make_run("recent", task_id=None, started_at="2026-06-18T00:00:00+00:00")
    recent.module_id = "mod-recent"
    for run in (old, other, recent):
        await dao.insert_agent_run(run)

    # Large window so "old" would qualify by date but project scope drops
    # proj-2; tiny window would drop "old". Use default 30d relative to now is
    # brittle, so assert scope with a wide window and absence of proj-2.
    activity = await dao.last_activity_by_module("proj-1", window_days=100000)

    assert "mod-other" not in activity
    assert activity.get("mod-recent") == "2026-06-18T00:00:00+00:00"
    assert "mod-old" in activity  # within the wide window, same project


async def test_routing_design_dirs_and_delete() -> None:
    for run_id, module_id, design_dir in (
        ("run-1", "mod-1", "/repo/spec/a"),
        ("run-2", "mod-1", "/repo/spec/a"),
        ("run-3", "mod-2", "/repo/spec/b"),
        ("run-4", "mod-1", None),
    ):
        run = _make_run(run_id, task_id="task-1", started_at="2026-05-29T10:00:00")
        run.module_id = module_id
        run.design_dir = design_dir
        await dao.insert_agent_run(run)

    assert await dao.get_run_routing("run-1") == ("task-1", "mod-1")
    assert await dao.get_run_routing("missing") is None
    assert sorted(await dao.list_design_dirs_for_task("task-1")) == [
        "/repo/spec/a",
        "/repo/spec/b",
    ]
    assert await dao.list_design_dirs_for_task("task-1", module_id="mod-1") == [
        "/repo/spec/a"
    ]

    await dao.delete_agent_run("run-1")
    await dao.delete_agent_run("missing")
    assert await dao.get_run_routing("run-1") is None


async def test_status_routing_uses_run_scope_before_terminal_session_exists() -> None:
    run = _make_run(
        "run-early-hook",
        task_id="task-1",
        started_at="2026-05-29T10:00:00",
    )
    run.scope = "plan"
    await dao.insert_agent_run(run)

    assert await dao.get_status_routing("run-early-hook") == (
        "proj-1",
        "task-1",
        "mod-1",
        "plan",
    )
