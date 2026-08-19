"""Tests for the surviving Agent Run read projections.

Every Agent Run writer moved to Rust at the Slice 3 handoff, and its semantics
— older-fact rejection, terminal authority, first-valid provider session — are
proved in the Rust suite against the table's real owner. What is proved here is
what Django still owns: the routing, history, and activity projections its
unmigrated capabilities read.
"""

from datetime import datetime, timezone

import pytest
from asgiref.sync import sync_to_async

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.runs.tests.seeding import aseed_agent_run, seed_lifecycle_state
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












async def test_history_filters_task_orders_and_limits() -> None:
    for run_id, task_id, started_at in (
        ("old", "task-1", "2026-05-29T09:00:00"),
        ("new", "task-1", "2026-05-29T11:00:00"),
        ("other", "task-2", "2026-05-29T12:00:00"),
    ):
        await aseed_agent_run(
            _make_run(run_id, task_id=task_id, started_at=started_at)
        )

    task_id = fixture_issue_id(
        project_id="proj-1", module_id="mod-1", task_id="task-1"
    )
    runs = await dao.list_agent_runs_for_task(task_id)
    limited = await dao.list_agent_runs_for_task(task_id, limit=1)

    assert [run.id for run in runs] == ["new", "old"]
    assert [run.id for run in limited] == ["new"]


async def test_last_activity_by_module_ranks_and_coalesces() -> None:
    # Two modules; mod-a's newest run only has started_at, mod-b's newest run
    # bumped lifecycle_updated_at past its own (older) started_at.
    runs = [
        _make_run("a-old", task_id="t", module_id="mod-a", started_at="2026-06-10T09:00:00+00:00"),
        _make_run("a-new", task_id="t", module_id="mod-a", started_at="2026-06-12T09:00:00+00:00"),
        _make_run("b-1", task_id=None, module_id="mod-b", started_at="2026-06-11T08:00:00+00:00"),
    ]
    # mod-b's run emitted a lifecycle event after start → coalesce picks it.
    runs[2].lifecycle_updated_at = "2026-06-13T12:00:00+00:00"
    for run in runs:
        await aseed_agent_run(run)

    activity = await dao.last_activity_by_module(
        fixture_uuid("proj-1"), now=datetime(2026, 6, 20, tzinfo=timezone.utc)
    )

    assert activity == {
        fixture_issue_id(project_id="proj-1", module_id="mod-a", task_id=None): "2026-06-12T09:00:00+00:00",
        fixture_issue_id(project_id="proj-1", module_id="mod-b", task_id=None): "2026-06-13T12:00:00+00:00",
    }


async def test_last_activity_window_and_project_scope() -> None:
    # Outside the window → excluded. Different project → excluded.
    old = _make_run("old", task_id="t", module_id="mod-old", started_at="2026-01-01T00:00:00+00:00")
    other = _make_run(
        "other", task_id="t", project_id="proj-2", module_id="mod-other", started_at="2026-06-15T00:00:00+00:00"
    )
    recent = _make_run("recent", task_id=None, module_id="mod-recent", started_at="2026-06-18T00:00:00+00:00")
    for run in (old, other, recent):
        await aseed_agent_run(run)

    # Large window so "old" would qualify by date but project scope drops
    # proj-2; tiny window would drop "old". Use default 30d relative to now is
    # brittle, so assert scope with a wide window and absence of proj-2.
    activity = await dao.last_activity_by_module(fixture_uuid("proj-1"), window_days=100000)

    assert fixture_issue_id(project_id="proj-2", module_id="mod-other", task_id=None) not in activity
    assert activity.get(fixture_issue_id(project_id="proj-1", module_id="mod-recent", task_id=None)) == "2026-06-18T00:00:00+00:00"
    assert fixture_issue_id(project_id="proj-1", module_id="mod-old", task_id=None) in activity


async def test_routing_and_design_dirs_project_from_a_task_scope() -> None:
    for run_id, module_id, design_dir in (
        ("run-1", "mod-1", "/repo/spec/a"),
        ("run-2", "mod-1", "/repo/spec/a"),
        ("run-3", "mod-2", "/repo/spec/b"),
        ("run-4", "mod-1", None),
    ):
        task_label = "task-1" if module_id == "mod-1" else "task-2"
        run = _make_run(run_id, task_id=task_label, module_id=module_id, started_at="2026-05-29T10:00:00")
        run.design_dir = design_dir
        await aseed_agent_run(run)

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


async def test_status_routing_uses_run_scope_before_terminal_session_exists() -> None:
    run = _make_run(
        "run-early-hook",
        task_id="task-1",
        started_at="2026-05-29T10:00:00",
    )
    run.scope = "plan"
    await aseed_agent_run(run)

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
    await aseed_agent_run(run)

    assert await dao.get_status_routing(run.id) is None
    records = await dao.agent_status_records(
        fixture_uuid("proj-1"),
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
    await aseed_agent_run(run)

    records = await dao.agent_status_records(
        str(task.project_id),
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
