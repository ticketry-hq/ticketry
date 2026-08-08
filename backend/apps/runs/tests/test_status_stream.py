"""Project-scoped status WebSocket contract (T962-S2)."""

import asyncio
import time
import uuid
from unittest.mock import AsyncMock

import pytest
from asgiref.sync import sync_to_async
from channels.testing.websocket import WebsocketCommunicator

from apps.runs import dao
from apps.runs.consumers import StatusStreamConsumer
from apps.runs.api import ingest_lifecycle_event
from apps.runs.bus import (
    publish_automation_attempt,
    publish_backend_session,
    publish_document,
)
from apps.runs.models import AgentRun, AutomationAttempt
from apps.terminals.models import AgentTerminalSession
from studio_server.asgi import application
from studio_server.contracts import AutomationAttemptRecord, LifecycleEvent
from django.db import OperationalError, close_old_connections, transaction
from django.utils import timezone
from worktracker.models import Issue, IssueType, Project, State, Workspace
from worktracker.services import workflow_config
from worktracker.tests.factories import fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)
PROJECT_1_ID = fixture_uuid("proj-1")
PROJECT_2_ID = fixture_uuid("proj-2")
MODULE_1_ID = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None)
TASK_1_ID = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")


async def _issue_type(project: Project, *, level: str = "task") -> IssueType:
    """Create the explicit type required by current work-item fixtures."""

    return await sync_to_async(IssueType.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Task" if level == "task" else "Module",
        level=level,
    )


async def _seed_run(
    run_id: str, *, project_id: str = "proj-1", scope: str = "task"
) -> None:
    await dao.insert_agent_run(
        AgentRun(
            id=run_id,
            issue_id=fixture_issue_id(
                project_id=project_id, module_id="mod-1", task_id="task-1"
            ),
            agent="codex",
            status="running",
            started_at="2026-07-12T10:00:00+00:00",
            scope=scope,
        )
    )
    await AgentTerminalSession.objects.acreate(
        agent_run_id=run_id,
        tmux_session_name=f"tmux-{run_id}",
        task_id="task-1",
        module_id="mod-1",
        project_id=project_id,
        agent="codex",
        created_at="2026-07-12T10:00:00+00:00",
        scope=scope,
    )


async def _connect(
    project_id: str | None, *, cursor: int | None = None
) -> WebsocketCommunicator:
    path = "/ws/status"
    if project_id is not None:
        path += f"?project_id={project_id}"
        if cursor is not None:
            path += f"&cursor={cursor}"
    return WebsocketCommunicator(application, path)


async def test_status_frame_is_ignored_after_disconnect() -> None:
    """A group event queued behind disconnect must not write to a closed ASGI socket."""

    consumer = StatusStreamConsumer()
    consumer._disconnected = True
    consumer.send_json = AsyncMock()

    await consumer.status_frame({"frame": {"v": 1, "type": "test"}})

    consumer.send_json.assert_not_awaited()


async def test_status_requires_project_id() -> None:
    socket = await _connect(None)
    connected, _ = await socket.connect()
    assert connected is False


async def test_connect_sends_versioned_authoritative_snapshot() -> None:
    await _seed_run("run-1")
    await _seed_run("other", project_id="proj-2")

    socket = await _connect(PROJECT_1_ID)
    connected, _ = await socket.connect()
    assert connected

    frame = await socket.receive_json_from()
    assert frame["v"] == 1
    assert frame["type"] == "snapshot"
    assert frame["scope"] == {"project_id": PROJECT_1_ID, "task_id": None}
    project = await Project.objects.aget(pk=PROJECT_1_ID)
    assert frame["work_item_cursor"] == project.state_revision
    assert frame["workflow_states"] == []
    assert [run["agent_run_id"] for run in frame["runs"]] == ["run-1"]
    assert frame["at"]
    await socket.disconnect()


async def test_state_group_change_is_published_to_active_project_client() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="catalog-live", name="Catalog live"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Catalog", slug="CATALOG"
    )
    state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Review",
        group="started",
        color="#7dcfff",
        sort_order=2,
    )
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()  # snapshot

    updated = await sync_to_async(workflow_config.update_state)(
        state.id, {"group": "completed"}
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "workflow_state",
        "project_id": str(project.id),
        "state": {
            "id": str(state.id),
            "name": "Review",
            "group": "completed",
            "color": "#7dcfff",
            "sort_order": 2,
            "is_protected": False,
        },
        "updated_at": updated.updated_at.isoformat(),
    }
    await socket.disconnect()

    reconnected = await _connect(str(project.id))
    assert (await reconnected.connect())[0]
    snapshot = await reconnected.receive_json_from()
    assert snapshot["workflow_states"] == [
        {
            "id": str(state.id),
            "name": "Review",
            "group": "completed",
            "color": "#7dcfff",
            "sort_order": 2,
            "is_protected": False,
        }
    ]
    await reconnected.disconnect()


async def _catalog_project(slug: str) -> Project:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug=slug, name=slug
    )
    return await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Catalog", slug=slug.upper()
    )


async def test_state_rename_and_recolor_are_published_to_active_project_client() -> (
    None
):
    """A same-group edit still has to reach peers (#1462).

    Rename and recolor leave ``group`` untouched, so the old group-only
    comparison dropped them and every other client kept rendering the stale row.
    """

    project = await _catalog_project("catalog-rename")
    state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Review",
        group="started",
        color="#7dcfff",
        sort_order=2,
    )
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()  # snapshot

    updated = await sync_to_async(workflow_config.update_state)(
        state.id, {"name": "In review", "color": "#ff9e64"}
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "workflow_state",
        "project_id": str(project.id),
        "state": {
            "id": str(state.id),
            "name": "In review",
            "group": "started",
            "color": "#ff9e64",
            "sort_order": 2,
            "is_protected": False,
        },
        "updated_at": updated.updated_at.isoformat(),
    }
    await socket.disconnect()


async def test_state_reorder_publishes_every_renumbered_row() -> None:
    project = await _catalog_project("catalog-reorder")
    first = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Ready",
        group="unstarted",
        color="#7dcfff",
        sort_order=0,
    )
    second = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Implement",
        group="started",
        color="#9ece6a",
        sort_order=1,
    )
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()  # snapshot

    await sync_to_async(workflow_config.reorder_states)(
        project.id, [second.id, first.id]
    )

    frames = [await socket.receive_json_from() for _ in range(2)]
    assert {(f["state"]["id"], f["state"]["sort_order"]) for f in frames} == {
        (str(second.id), 0),
        (str(first.id), 1),
    }
    assert all(f["type"] == "workflow_state" for f in frames)
    assert await socket.receive_nothing()
    await socket.disconnect()


async def test_save_leaving_projection_unchanged_publishes_nothing() -> None:
    """Only projected fields matter; an idempotent write stays off the feed."""

    project = await _catalog_project("catalog-noop")
    state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Review",
        group="started",
        color="#7dcfff",
        sort_order=2,
    )
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()  # snapshot

    await sync_to_async(workflow_config.update_state)(
        state.id, {"name": "Review", "group": "started"}
    )

    assert await socket.receive_nothing()
    await socket.disconnect()


async def test_connect_reconciles_unresolved_automation_attempts() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="attempt-status", name="attempt-status"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Attempt status", slug="ATTEMPT"
    )
    issue_type = await _issue_type(project)
    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Failed automation",
        sequence_id=1,
    )
    attempt = await sync_to_async(AutomationAttempt.objects.create)(
        transition_id=uuid.uuid4(),
        issue=issue,
        from_state_id=uuid.uuid4(),
        to_state_id=uuid.uuid4(),
        workflow_revision=3,
        status=AutomationAttempt.Status.FAILED,
        error="tmux unavailable",
    )

    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    frame = await socket.receive_json_from()

    assert frame["automation_attempts"] == [
        {
            "attempt_id": str(attempt.id),
            "root_attempt_id": str(attempt.id),
            "retry_of_attempt_id": None,
            "work_item_id": str(issue.id),
            "status": "failed",
            "error": "tmux unavailable",
            "failure": None,
            "retryable": True,
            "agent_run_id": None,
            "updated_at": attempt.updated_at.isoformat(),
        }
    ]
    await socket.disconnect()


async def test_connect_omits_dismissed_automation_attempts() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="dismissed-attempt", name="dismissed-attempt"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Dismissed attempt", slug="DISMISS"
    )
    issue_type = await _issue_type(project)
    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Dismissed automation",
        sequence_id=1,
    )
    await sync_to_async(AutomationAttempt.objects.create)(
        transition_id=uuid.uuid4(),
        issue=issue,
        from_state_id=uuid.uuid4(),
        to_state_id=uuid.uuid4(),
        workflow_revision=3,
        status=AutomationAttempt.Status.FAILED,
        error="historical failure",
        dismissed_at=timezone.now(),
    )

    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    frame = await socket.receive_json_from()

    assert frame["automation_attempts"] == []
    await socket.disconnect()


async def test_lifecycle_delta_is_self_sufficient_run_record() -> None:
    await _seed_run("run-1", scope="task")
    socket = await _connect(PROJECT_1_ID)
    assert (await socket.connect())[0]
    await socket.receive_json_from()  # snapshot

    await ingest_lifecycle_event(
        LifecycleEvent(
            agent_run_id="run-1",
            agent="codex",
            kind="turn_start",
            ts="2026-07-12T10:01:00Z",
        ),
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "agent_lifecycle",
        "at": "2026-07-12T10:01:00+00:00",
        "run": {
            "agent_run_id": "run-1",
            "project_id": PROJECT_1_ID,
            "task_id": TASK_1_ID,
            "module_id": MODULE_1_ID,
            "agent": "codex",
            "scope": "task",
            "started_at": "2026-07-12T10:00:00+00:00",
            "state": "working",
            "updated_at": "2026-07-12T10:01:00+00:00",
        },
    }
    await socket.disconnect()


async def test_backend_and_document_frames_are_project_scoped() -> None:
    socket = await _connect(PROJECT_1_ID)
    assert (await socket.connect())[0]
    await socket.receive_json_from()

    await publish_backend_session(PROJECT_1_ID, "run-1", "lost", at="now")
    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "backend_session",
        "agent_run_id": "run-1",
        "status": "lost",
        "at": "now",
    }

    await publish_document(
        PROJECT_1_ID,
        {"type": "document", "task_id": "task-1", "doc": {"id": "d1"}},
        at="now",
    )
    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "document",
        "task_id": "task-1",
        "doc": {"id": "d1"},
        "at": "now",
    }
    await socket.disconnect()


async def test_automation_attempt_frame_is_typed_and_project_scoped() -> None:
    socket = await _connect(PROJECT_1_ID)
    assert (await socket.connect())[0]
    await socket.receive_json_from()
    other_project_socket = await _connect(PROJECT_2_ID)
    assert (await other_project_socket.connect())[0]
    await other_project_socket.receive_json_from()

    await publish_automation_attempt(
        PROJECT_1_ID,
        AutomationAttemptRecord(
            attempt_id="attempt-2",
            root_attempt_id="attempt-1",
            retry_of_attempt_id="attempt-1",
            work_item_id="task-1",
            status="failed",
            error="tmux unavailable",
            retryable=True,
            agent_run_id=None,
            updated_at="2026-07-16T10:00:00+00:00",
        ),
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "automation_attempt",
        "project_id": PROJECT_1_ID,
        "attempt": {
            "attempt_id": "attempt-2",
            "root_attempt_id": "attempt-1",
            "retry_of_attempt_id": "attempt-1",
            "work_item_id": "task-1",
            "status": "failed",
            "error": "tmux unavailable",
            "failure": None,
            "retryable": True,
            "agent_run_id": None,
            "updated_at": "2026-07-16T10:00:00+00:00",
        },
    }
    assert await other_project_socket.receive_nothing()
    await socket.disconnect()
    await other_project_socket.disconnect()


async def test_committed_state_change_publishes_complete_project_delta() -> None:
    """The post-commit worktracker seam uses the existing project feed."""

    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="status-feed", name="status-feed"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Status feed", slug="STATUS"
    )
    before = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    after = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(),
        project=project,
        name="Done",
        group="completed",
        color="#0a0",
        sort_order=7,
        is_protected=True,
    )
    issue_type = await _issue_type(project)
    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Item",
        sequence_id=1,
        state=before,
    )

    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()
    other_project_socket = await _connect(fixture_uuid("other-project"))
    assert (await other_project_socket.connect())[0]
    await other_project_socket.receive_json_from()

    issue.state = after
    await sync_to_async(issue.save)()

    frame = await socket.receive_json_from()
    assert frame["v"] == 1
    assert frame["type"] == "work_item_state"
    assert frame["project_id"] == str(project.id)
    assert frame["work_item_id"] == str(issue.id)
    assert frame["revision"] == issue.state_revision
    assert frame["state"] == {
        "id": str(after.id),
        "name": "Done",
        "group": "completed",
        "color": "#0a0",
        "sort_order": 7,
        "is_protected": True,
    }
    assert frame["updated_at"]
    assert await other_project_socket.receive_nothing()
    await socket.disconnect()
    await other_project_socket.disconnect()


async def test_create_and_field_edit_publish_distinct_change_revisions() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="changed", name="changed"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Changed", slug="CHANGED"
    )
    state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    issue_type = await _issue_type(project)
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    assert (await socket.receive_json_from())["work_item_cursor"] == 0

    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Created",
        sequence_id=1,
        state=state,
    )
    created = await socket.receive_json_from()
    assert (created["work_item_id"], created["revision"]) == (str(issue.id), 1)
    assert created["membership_changed"] is True

    issue.name = "Edited externally"
    issue.description = "Fresh description"
    await sync_to_async(issue.save)(update_fields=["name", "description", "updated_at"])
    edited = await socket.receive_json_from()
    assert (edited["work_item_id"], edited["revision"]) == (str(issue.id), 2)
    assert edited["membership_changed"] is False
    await socket.disconnect()

    replay = await _connect(str(project.id), cursor=0)
    assert (await replay.connect())[0]
    assert (await replay.receive_json_from())["work_item_cursor"] == 0
    latest = await replay.receive_json_from()
    assert (latest["work_item_id"], latest["revision"]) == (str(issue.id), 2)
    assert latest["membership_changed"] is True
    assert (await replay.receive_json_from())["revision"] == 2
    await replay.disconnect()


async def test_cursor_reconnect_replays_latest_project_projections_in_order() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="replay", name="replay"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Replay", slug="REPLAY"
    )
    other_project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Other", slug="OTHER"
    )
    todo = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    doing = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Doing", group="started"
    )
    done = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )
    other_state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=other_project, name="Other", group="started"
    )
    issue_type = await _issue_type(project)
    other_issue_type = await _issue_type(other_project)
    first = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="First",
        sequence_id=1,
    )
    second = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Second",
        sequence_id=2,
    )
    foreign = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=other_project,
        type="task",
        issue_type=other_issue_type,
        name="Foreign",
        sequence_id=1,
    )

    first.state = todo
    await sync_to_async(first.save)(update_fields=["state", "updated_at"])
    second.state = doing
    await sync_to_async(second.save)(update_fields=["state", "updated_at"])
    first.state = done
    await sync_to_async(first.save)(update_fields=["state", "updated_at"])
    foreign.state = other_state
    await sync_to_async(foreign.save)(update_fields=["state", "updated_at"])

    socket = await _connect(str(project.id), cursor=0)
    assert (await socket.connect())[0]
    snapshot = await socket.receive_json_from()
    assert snapshot["type"] == "snapshot"
    assert snapshot["work_item_cursor"] == 0

    replay = [await socket.receive_json_from(), await socket.receive_json_from()]
    assert [(frame["work_item_id"], frame["revision"]) for frame in replay] == [
        (str(second.id), 4),
        (str(first.id), 5),
    ]
    assert replay[-1]["state"]["id"] == str(done.id)
    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "cursor",
        "project_id": str(project.id),
        "revision": 5,
    }
    await socket.disconnect()

    duplicate = await _connect(str(project.id), cursor=5)
    assert (await duplicate.connect())[0]
    assert (await duplicate.receive_json_from())["work_item_cursor"] == 5
    assert await duplicate.receive_json_from() == {
        "v": 1,
        "type": "cursor",
        "project_id": str(project.id),
        "revision": 5,
    }
    assert await duplicate.receive_nothing()
    await duplicate.disconnect()


async def test_concurrent_project_transitions_publish_distinct_revisions() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="concurrent", name="concurrent"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Concurrent", slug="CONCUR"
    )
    states = [
        await sync_to_async(State.objects.create)(
            id=uuid.uuid4(), project=project, name=f"State {index}", group="started"
        )
        for index in range(2)
    ]
    issue_type = await _issue_type(project)
    issues = [
        await sync_to_async(Issue.objects.create)(
            id=uuid.uuid4(),
            project=project,
            type="task",
            issue_type=issue_type,
            name=f"Item {index}",
            sequence_id=index + 1,
        )
        for index in range(2)
    ]

    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    assert (await socket.receive_json_from())["work_item_cursor"] == 2

    def move(issue_id, state_id):
        # Django's shared in-memory SQLite test database locks whole tables;
        # retry only that harness-level contention while keeping both writers
        # on independent connections. Production row locking serializes them.
        for attempt in range(20):
            close_old_connections()
            try:
                issue = Issue.objects.get(pk=issue_id)
                issue.state_id = state_id
                issue.save(update_fields=["state", "updated_at"])
                return issue.state_revision
            except OperationalError as exc:
                if "locked" not in str(exc).lower() or attempt == 19:
                    raise
                time.sleep(0.01)
        raise AssertionError("unreachable")

    revisions = await asyncio.gather(
        *[
            sync_to_async(move, thread_sensitive=False)(issue.id, state.id)
            for issue, state in zip(issues, states)
        ]
    )

    assert sorted(revisions) == [3, 4]
    frames = [await socket.receive_json_from(), await socket.receive_json_from()]
    assert sorted(frame["revision"] for frame in frames) == [3, 4]
    await socket.disconnect()


async def test_one_transaction_publishes_each_frozen_destination_after_commit() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="frozen", name="frozen"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Frozen", slug="FROZEN"
    )
    states = [
        await sync_to_async(State.objects.create)(
            id=uuid.uuid4(), project=project, name=name, group=group
        )
        for name, group in (
            ("Todo", "unstarted"),
            ("Doing", "started"),
            ("Done", "completed"),
        )
    ]
    issue_type = await _issue_type(project)
    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Item",
        sequence_id=1,
        state=states[0],
    )
    socket = await _connect(str(project.id))
    assert (await socket.connect())[0]
    assert (await socket.receive_json_from())["work_item_cursor"] == 1

    def move_twice():
        with transaction.atomic():
            current = Issue.objects.get(pk=issue.id)
            current.state = states[1]
            current.save(update_fields=["state", "updated_at"])
            current.state = states[2]
            current.save(update_fields=["state", "updated_at"])

    await sync_to_async(move_twice)()

    frames = [await socket.receive_json_from(), await socket.receive_json_from()]
    assert [(frame["state"]["name"], frame["revision"]) for frame in frames] == [
        ("Doing", 2),
        ("Done", 3),
    ]
    await socket.disconnect()


async def test_unset_destination_is_live_and_replayable() -> None:
    workspace = await sync_to_async(Workspace.objects.create)(
        id=uuid.uuid4(), slug="unset", name="unset"
    )
    project = await sync_to_async(Project.objects.create)(
        id=uuid.uuid4(), workspace=workspace, name="Unset", slug="UNSET"
    )
    state = await sync_to_async(State.objects.create)(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    issue_type = await _issue_type(project)
    issue = await sync_to_async(Issue.objects.create)(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Item",
        sequence_id=1,
        state=state,
    )

    live = await _connect(str(project.id))
    assert (await live.connect())[0]
    assert (await live.receive_json_from())["work_item_cursor"] == 1
    issue.state = None
    await sync_to_async(issue.save)(update_fields=["state", "updated_at"])
    assert await live.receive_json_from() == {
        "v": 1,
        "type": "work_item_state",
        "project_id": str(project.id),
        "work_item_id": str(issue.id),
        "state": None,
        "revision": 2,
        "updated_at": issue.updated_at.isoformat(),
        "membership_changed": False,
    }
    await live.disconnect()

    replay = await _connect(str(project.id), cursor=1)
    assert (await replay.connect())[0]
    assert (await replay.receive_json_from())["work_item_cursor"] == 1
    projection = await replay.receive_json_from()
    assert projection["work_item_id"] == str(issue.id)
    assert projection["state"] is None
    assert projection["revision"] == 2
    assert (await replay.receive_json_from())["revision"] == 2
    await replay.disconnect()
