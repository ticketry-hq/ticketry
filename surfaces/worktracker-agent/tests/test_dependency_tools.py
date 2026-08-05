"""Tests for the MCP dependency surface (#699, #893).

The directed-edge writes are re-expressed over the generated work-item GET and
PATCH operations. These service tests
cover what the *agent* observes: KEY-N resolution, the SDK work item mapped
onto the edge-id result shape, the self-block/cycle 4xx folded to a clean error
off the SDK exception body, a 5xx propagating, and the read surface.
"""

import pytest
from worktracker_sdk.generated import PatchedWorkItemPatch
from worktracker_sdk.generated.exceptions import ApiException

from fake_sdk import (
    FakeGeneratedSdk,
    make_api_error,
    make_detail,
    make_flat_work_item,
    make_issue_type,
    make_state,
    make_work_item,
    raises,
)
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


TASK = "11111111-1111-1111-1111-111111111111"
BLOCKER = "22222222-2222-2222-2222-222222222222"
DEPENDENT = "33333333-3333-3333-3333-333333333333"


def _dep_error(status_code, detail, error_type=ApiException):
    return make_api_error(status_code, {"detail": detail}, error_type)


# --- Write: SDK result mapped onto the edge-id shape -------------------------


def test_set_task_blockers_maps_sdk_edges():
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK, blocked_by_ids=[DEPENDENT], blocks_ids=[]
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_task_blockers(TASK, [DEPENDENT])

    name, args, _kwargs = client.work_items.calls[0]
    assert name == "update_work_item"
    assert args[0] == TASK and isinstance(args[1], PatchedWorkItemPatch)
    assert [str(i) for i in args[1].blocked_by_ids] == [DEPENDENT]
    assert result == {
        "task_id": TASK,
        "blocked_by_ids": [DEPENDENT],
        "blocks_ids": [],
    }


def test_add_task_blocker_maps_sdk_edges():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_work_item(id=TASK)
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK, blocked_by_ids=[BLOCKER], blocks_ids=[DEPENDENT]
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.add_task_blocker(TASK, BLOCKER)

    name, args, _kwargs = client.work_items.calls[1]
    assert name == "update_work_item"
    assert args[0] == TASK and [str(i) for i in args[1].blocked_by_ids] == [BLOCKER]
    assert result == {
        "task_id": TASK,
        "blocked_by_ids": [BLOCKER],
        "blocks_ids": [DEPENDENT],
    }


def test_add_task_dependent_writes_edge_on_the_dependent():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_work_item(id=DEPENDENT)
    client.work_items.returns["update_work_item"] = make_work_item(
        id=DEPENDENT, blocked_by_ids=[TASK], blocks_ids=[]
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.add_task_dependent(TASK, DEPENDENT)

    # add_dependent(task, dependent) == add_blocker on the dependent, by task.
    name, args, _kwargs = client.work_items.calls[1]
    assert name == "update_work_item"
    assert args[0] == DEPENDENT and [str(i) for i in args[1].blocked_by_ids] == [TASK]
    assert result["task_id"] == DEPENDENT
    assert result["blocked_by_ids"] == [TASK]


# --- Write: KEY-N resolution on both ends ------------------------------------


def test_set_task_blockers_resolves_keys():
    """A KEY-N on either end is resolved to a UUID before the SDK write."""
    client = FakeGeneratedSdk()

    def fake_get(id_or_key):
        return {
            "CODIN-1": make_detail(make_work_item(id=TASK)),
            "CODIN-2": make_detail(make_work_item(id=BLOCKER)),
        }[id_or_key]

    client.work_items.returns["get_work_item"] = fake_get
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK, blocked_by_ids=[BLOCKER], blocks_ids=[]
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_task_blockers("CODIN-1", ["CODIN-2"])

    set_call = next(c for c in client.work_items.calls if c[0] == "update_work_item")
    assert set_call[1][0] == TASK
    assert [str(i) for i in set_call[1][1].blocked_by_ids] == [BLOCKER]
    assert result["task_id"] == TASK


# --- Write: self-block / cycle 4xx → clean error, no write -------------------


def test_self_block_returns_clean_error():
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = raises(
        _dep_error(422, "An issue cannot block itself.")
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_task_blockers(TASK, [TASK])

    assert result == {"task_id": TASK, "error": "An issue cannot block itself."}


def test_cycle_returns_clean_error():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_work_item(id=TASK)
    client.work_items.returns["update_work_item"] = raises(
        _dep_error(422, "That blocker would create a cycle.")
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.add_task_blocker(TASK, BLOCKER)

    assert result == {"task_id": TASK, "error": "That blocker would create a cycle."}


def test_server_error_still_raises():
    """A 5xx is not a guard message — it propagates, not swallowed silently."""
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = raises(_dep_error(500, "boom"))
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ApiException):
        service.set_task_blockers(TASK, [BLOCKER])


# --- Read: edge id arrays on the task schema ---------------------------------


def test_get_task_details_surfaces_edges():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_flat_work_item(
        id=TASK,
        name="T",
        project_id=BLOCKER,
        sequence_id=1,
        blocked_by_ids=[BLOCKER],
        blocks_ids=[DEPENDENT],
    )
    client.issue_types.returns["list_issue_types"] = [make_issue_type()]
    client.work_items.returns["list_work_items"] = []
    client.attachments.returns["list_work_item_attachments"] = []
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    detail = service.get_task_details(TASK)

    assert [str(i) for i in detail.blocked_by_ids] == [BLOCKER]
    assert [str(i) for i in detail.blocks_ids] == [DEPENDENT]


# --- Read: scope-context assembled from canonical CRUD reads -----------------


def test_get_scope_context_assembles_unresolved_edges_and_advisory():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_flat_work_item(
        id=TASK,
        key="CODIN-1",
        blocked_by_ids=[BLOCKER],
        blocks_ids=[DEPENDENT],
    )
    client.work_items.returns["list_work_items"] = [
        make_flat_work_item(
            id=BLOCKER,
            key="CODIN-2",
            name="blocker",
            state=BLOCKER,
        ),
        make_flat_work_item(
            id=DEPENDENT,
            key="CODIN-3",
            name="dependent",
        ),
    ]
    client.states.returns["list_states"] = [
        make_state(id=BLOCKER, name="Doing", group="started")
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    ctx = service.get_scope_context(TASK)

    assert set(ctx.model_dump()) == {"task", "depends_on", "depended_by", "advisory"}
    assert str(ctx.task.id) == TASK
    assert str(ctx.depends_on[0].id) == BLOCKER
    assert ctx.depends_on[0].state_group == "started"
    assert ctx.depends_on[0].resolved is False
    assert str(ctx.depended_by[0].id) == DEPENDENT
    assert ctx.advisory == (
        "1 of 1 blocker(s) unresolved (CODIN-2) - stay within this task; "
        "do not implement upstream work."
    )
    assert [call[0] for call in client.work_items.calls] == [
        "get_work_item",
        "list_work_items",
    ]
    assert client.work_items.calls[1][2] == {
        "include_archived": True,
        "include_pathfind": True,
    }


def test_get_scope_context_marks_resolved_blocker_and_keeps_advisory_shape():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_flat_work_item(
        id=TASK,
        key="CODIN-1",
        blocked_by_ids=[BLOCKER],
    )
    client.work_items.returns["list_work_items"] = [
        make_flat_work_item(
            id=BLOCKER,
            key="CODIN-2",
            name="blocker",
            state=BLOCKER,
        )
    ]
    client.states.returns["list_states"] = [
        make_state(id=BLOCKER, name="Done", group="completed")
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    ctx = service.get_scope_context("CODIN-1")

    assert ctx.depends_on[0].resolved is True
    assert ctx.depends_on[0].state_group == "completed"
    assert ctx.advisory == (
        "No unresolved blockers - deliver only this task and nothing beyond its scope."
    )


# --- Registration ------------------------------------------------------------


def test_dependency_tools_are_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert {
        "add_task_blocker",
        "add_task_dependent",
        "set_task_blockers",
        "get_task_scope_context",
    } <= tool_names
