"""Tests for the agent-runs Django DAO."""

from datetime import datetime, timezone

import pytest
from asgiref.sync import sync_to_async
from django.db import IntegrityError

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue
from worktracker.tests.factories import (
    ensure_issue,
    fixture_issue_id,
    fixture_uuid,
)


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def issue_graphs():
    for project_id, module_id, task_ids in (
        ("proj-1", "mod-1", ("task-1", "task-2", "t")),
        ("proj-1", "mod-a", ("t",)),
        ("proj-1", "mod-b", ()),
        ("proj-1", "mod-old", ("t",)),
        ("proj-1", "mod-recent", ()),
        ("proj-2", "mod-other", ("t",)),
        ("proj-1", "mod-2", ("task-2",)),
    ):
        ensure_issue(project_id=project_id, module_id=module_id, task_id=None)
        for task_id in task_ids:
            ensure_issue(
                project_id=project_id, module_id=module_id, task_id=task_id
            )


def _make_run(
    run_id: str,
    *,
    task_id: str | None,
    started_at: str,
    project_id: str = "proj-1",
    module_id: str = "mod-1",
) -> AgentRun:
    """Build a fully-populated run."""

    return AgentRun(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id=project_id, module_id=module_id, task_id=task_id
        ),
        ticket_seq=472,
        agent="claude",
        status="running",
        started_at=started_at,
        cwd="/tmp/work",
        scope="task" if task_id is not None else "plan",
    )


async def test_insert_round_trips_full_row() -> None:
    await dao.insert_agent_run(
        _make_run("run-1", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    stored = await dao.list_agent_runs_for_task(
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")
    )

    assert len(stored) == 1
    assert stored[0].id == "run-1"
    assert str(stored[0].issue_id) == fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id="task-1"
    )
    assert stored[0].ticket_seq == 472
    assert stored[0].cwd == "/tmp/work"


async def test_insert_round_trips_nullable_fields() -> None:
    await dao.insert_agent_run(
        AgentRun(
            id="run-null",
            issue_id=fixture_issue_id(
                project_id="proj-1", module_id="mod-1", task_id=None
            ),
            agent="codex",
            status="running",
            started_at="2026-05-29T10:00:00",
            scope="plan",
        )
    )

    run = await AgentRun.objects.aget(id="run-null")

    assert run.issue_id is not None
    assert run.ticket_seq is None
    assert run.ended_at is None
    assert run.exit_code is None
    assert run.error is None
    assert run.cwd is None
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
    assert str(stored.issue_id) == fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id="task-1"
    )


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


async def test_lifecycle_update_is_refused_once_a_run_has_ended() -> None:
    """A finished run is frozen: process exit outranks any hook report (#1462).

    An agent whose process outlives its tmux session keeps POSTing to the
    lifecycle ingress baked into its launch command. Those late events carry a
    fresh timestamp, so the monotonicity check alone would happily resurrect a
    run that ended days earlier.
    """

    await dao.insert_agent_run(
        _make_run("run-ended", task_id="task-1", started_at="2026-05-29T10:00:00")
    )
    assert await dao.set_lifecycle_state(
        "run-ended", "permission_required", updated_at="2026-05-29T10:05:00+00:00"
    ) is True

    await dao.update_agent_run_exit(
        "run-ended", status="exited", ended_at="2026-05-29T10:06:00+00:00"
    )

    # Strictly newer than both the last state and the exit, so only the
    # ended_at guard can reject it.
    assert await dao.set_lifecycle_state(
        "run-ended", "working", updated_at="2026-06-12T09:00:00+00:00"
    ) is False

    stored = await AgentRun.objects.aget(id="run-ended")
    assert stored.lifecycle_state == "permission_required"
    assert stored.lifecycle_updated_at == "2026-05-29T10:05:00+00:00"


async def test_lifecycle_update_still_applies_while_a_run_is_live() -> None:
    """The ended_at guard must not freeze a run that is still going."""

    await dao.insert_agent_run(
        _make_run("run-live", task_id="task-1", started_at="2026-05-29T10:00:00")
    )

    assert await dao.set_lifecycle_state(
        "run-live", "working", updated_at="2026-05-29T10:05:00+00:00"
    ) is True
    assert await dao.set_lifecycle_state(
        "run-live", "exited", updated_at="2026-05-29T10:07:00+00:00"
    ) is True

    stored = await AgentRun.objects.aget(id="run-live")
    assert stored.lifecycle_state == "exited"


async def test_history_filters_task_orders_and_limits() -> None:
    for run_id, task_id, started_at in (
        ("old", "task-1", "2026-05-29T09:00:00"),
        ("new", "task-1", "2026-05-29T11:00:00"),
        ("other", "task-2", "2026-05-29T12:00:00"),
    ):
        await dao.insert_agent_run(
            _make_run(run_id, task_id=task_id, started_at=started_at)
        )

    task_id = fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id="task-1"
    )
    runs = await dao.list_agent_runs_for_task(task_id)
    limited = await dao.list_agent_runs_for_task(task_id, limit=1)

    assert [run.id for run in runs] == ["new", "old"]
    assert [run.id for run in limited] == ["new"]


async def test_routing_design_dirs_and_delete() -> None:
    for run_id, module_id, design_dir in (
        ("run-1", "mod-1", "/repo/spec/a"),
        ("run-2", "mod-1", "/repo/spec/a"),
        ("run-3", "mod-2", "/repo/spec/b"),
        ("run-4", "mod-1", None),
    ):
        task_label = "task-1" if module_id == "mod-1" else "task-2"
        run = _make_run(run_id, task_id=task_label, module_id=module_id, started_at="2026-05-29T10:00:00")
        run.design_dir = design_dir
        await dao.insert_agent_run(run)

    task_1_id = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")
    mod_1_id = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None)
    assert await dao.get_run_routing("run-1") == (task_1_id, mod_1_id)
    assert await dao.get_run_routing("missing") is None
    assert await dao.list_design_dirs_for_task(task_1_id) == [
        "/repo/spec/a"
    ]
    assert await dao.list_design_dirs_for_task(task_1_id, module_id=mod_1_id) == [
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
        fixture_uuid("proj-1"),
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1"),
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None),
        "plan",
        "claude",
        "2026-05-29T10:00:00",
    )


async def test_doc_chat_runs_are_not_published_to_the_client() -> None:
    run = _make_run(
        "hidden-doc-run",
        task_id="task-1",
        started_at="2026-05-29T10:00:00",
    )
    run.scope = "docchat"
    await dao.insert_agent_run(run)

    assert await dao.get_status_routing(run.id) is None
    records = await dao.agent_status_records(
        fixture_uuid("proj-1"),
        runtime_namespace="current-runtime",
        now=datetime(2026, 5, 29, 11, tzinfo=timezone.utc),
    )
    assert run.id not in {record.agent_run_id for record in records}


async def test_parentless_task_run_routes_as_a_task() -> None:
    scaffold_task = await sync_to_async(ensure_issue)(
        project_id="parentless-project",
        module_id="scaffold-module",
        task_id="scaffold-task",
    )
    task_id = fixture_uuid("parentless-task")
    task = await Issue.objects.acreate(
        id=task_id,
        project_id=scaffold_task.project_id,
        type="task",
        issue_type_id=scaffold_task.issue_type_id,
        parent=None,
        module=None,
        name="Parentless task",
        sequence_id=3,
    )
    run = AgentRun(
        id="parentless-task-run",
        issue=task,
        agent="codex",
        status="running",
        started_at="2026-08-03T10:00:00+00:00",
        scope="task",
    )
    await dao.insert_agent_run(run)
    await AgentTerminalSession.objects.acreate(
        agent_run=run,
        tmux_session_name=f"tmux-{run.id}",
        task_id=str(task.id),
        module_id=str(task.id),
        project_id=str(task.project_id),
        agent=run.agent,
        created_at=run.started_at,
        runtime_namespace="current-runtime",
        scope=run.scope,
    )

    records = await dao.agent_status_records(
        str(task.project_id),
        runtime_namespace="current-runtime",
        now=datetime(2026, 8, 3, 11, tzinfo=timezone.utc),
    )

    assert len(records) == 1
    assert records[0].task_id == task_id
    assert records[0].module_id == task_id
    assert await dao.get_run_routing(run.id) == (task_id, task_id)
    assert await dao.get_status_routing(run.id) == (
        str(task.project_id),
        task_id,
        task_id,
        "task",
        "codex",
        "2026-08-03T10:00:00+00:00",
    )


async def test_status_records_exclude_active_foreign_runtime_sessions() -> None:
    current = _make_run(
        "current-runtime-run",
        task_id="task-1",
        started_at="2026-08-10T10:00:00+00:00",
    )
    foreign = _make_run(
        "foreign-runtime-run",
        task_id="task-2",
        started_at="2026-08-10T10:01:00+00:00",
    )
    orphan = _make_run(
        "terminal-less-run",
        task_id="t",
        started_at="2026-08-10T10:02:00+00:00",
    )
    for run in (current, foreign, orphan):
        run.lifecycle_state = "working"
        await dao.insert_agent_run(run)
    for run, namespace in (
        (current, "current-runtime"),
        (foreign, "foreign-runtime"),
    ):
        await AgentTerminalSession.objects.acreate(
            agent_run=run,
            tmux_session_name=f"tmux-{run.id}",
            task_id=str(run.issue_id),
            module_id="mod-1",
            project_id="proj-1",
            agent=run.agent,
            created_at=run.started_at,
            runtime_namespace=namespace,
            scope=run.scope,
        )

    records = await dao.agent_status_records(
        fixture_uuid("proj-1"),
        runtime_namespace="current-runtime",
        now=datetime(2026, 8, 10, 11, tzinfo=timezone.utc),
    )

    assert [record.agent_run_id for record in records] == [current.id]
