"""Tests for the MCP lifecycle surface (#760).

The agent tool must read lifecycle fields from task details and write lifecycle
state only through the SDK's guarded lifecycle writer (#893). A guard 422 is
folded to a clean ``error`` read off the SDK exception body; a 5xx propagates.
"""

import inspect

import pytest
from worktracker_sdk.generated import LifecycleIn
from worktracker_sdk.generated.exceptions import ApiException, NotFoundException

from fake_sdk import (
    FakeGeneratedSdk,
    make_api_error,
    make_detail,
    make_work_item,
    raises,
)
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


TASK = "11111111-1111-1111-1111-111111111111"
PROJECT = "22222222-2222-2222-2222-222222222222"


def _api_error(status_code, detail, error_type=ApiException):
    return make_api_error(status_code, {"detail": detail}, error_type)


# --- Read: lifecycle fields on task details ----------------------------------


def test_get_task_details_surfaces_lifecycle_fields():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_detail(
        make_work_item(
            id=TASK,
            name="T",
            project_id=PROJECT,
            sequence_id=1,
            lifecycle_state="backlog",
            lifecycle_transitions=["refining", "failed"],
        )
    )
    client.work_items.returns["list_project_work_items"] = []
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    detail = service.get_task_details(TASK)

    assert detail.lifecycle_state == "backlog"
    assert detail.lifecycle_transitions == ["refining", "failed"]


# --- Write: guarded lifecycle writer -----------------------------------------


def test_set_lifecycle_calls_sdk_writer():
    client = FakeGeneratedSdk()
    client.work_items.returns["set_work_item_lifecycle"] = make_work_item(
        id=TASK,
        lifecycle_state="backlog",
        lifecycle_transitions=["cancelled", "failed", "refining"],
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_lifecycle(TASK, "backlog")

    # A bare UUID resolves without a get(); only the writer is called.
    assert [c[0] for c in client.work_items.calls] == ["set_work_item_lifecycle"]
    _name, args, _kwargs = client.work_items.calls[0]
    assert args[0] == TASK and isinstance(args[1], LifecycleIn)
    assert args[1].target == "backlog"
    assert result == {
        "work_item_id": TASK,
        "lifecycle_state": "backlog",
        "lifecycle_transitions": ["cancelled", "failed", "refining"],
    }


def test_set_lifecycle_resolves_key_before_write():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_detail(make_work_item(id=TASK))
    client.work_items.returns["set_work_item_lifecycle"] = make_work_item(
        id=TASK,
        lifecycle_state="split_created",
        lifecycle_transitions=["backlog"],
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_lifecycle("CODIN-760", "split_created")

    # A KEY-N resolves through get() first, then the writer runs on the UUID.
    assert [c[0] for c in client.work_items.calls] == [
        "get_work_item",
        "set_work_item_lifecycle",
    ]
    assert result["work_item_id"] == TASK
    assert result["lifecycle_state"] == "split_created"


def test_set_lifecycle_guard_error_returns_clean_error():
    client = FakeGeneratedSdk()
    client.work_items.returns["set_work_item_lifecycle"] = raises(
        _api_error(422, "Cannot transition lifecycle 'backlog' -> 'done'.")
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_lifecycle(TASK, "done")

    assert result == {
        "work_item_id": TASK,
        "error": "Cannot transition lifecycle 'backlog' -> 'done'.",
    }


def test_set_lifecycle_resolution_4xx_returns_original_id():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = raises(
        _api_error(404, "Not found", error_type=NotFoundException)
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.set_lifecycle("CODIN-9999", "backlog")

    assert result == {"work_item_id": "CODIN-9999", "error": "Not found"}


def test_set_lifecycle_server_error_still_raises():
    client = FakeGeneratedSdk()
    client.work_items.returns["set_work_item_lifecycle"] = raises(
        _api_error(500, "boom")
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ApiException):
        service.set_lifecycle(TASK, "backlog")


# --- Registration -------------------------------------------------------------


def test_set_lifecycle_tool_signature_is_public():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["set_lifecycle"]).parameters) == (
        "work_item_id",
        "target",
    )


def test_lifecycle_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "set_lifecycle" in tool_names
