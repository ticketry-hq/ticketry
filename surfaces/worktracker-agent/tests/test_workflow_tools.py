"""The MCP status tool as a workflow write door (#872).

``update_task_status`` is one of the three doors onto the sole-writer gate
(#860): the UI PATCH, this MCP tool, and the FE bulk fan-out all reach
``PATCH /work-items/{id}``. This suite proves the tool surfaces the gate's
*structured, machine-readable* rejection (``detail``/``code``/``from``/``to``)
to the agent rather than swallowing it to a bool or letting a raw error escape
— the same reason the UI receives, so no door is a weaker gate than the others.

The transition is re-expressed as a generated ``update_work_item`` call and the
gate reason is read off the generated exception body.
"""

import inspect

import pytest
from worktracker_sdk.generated import WorkItemPatch
from worktracker_sdk.generated.exceptions import ApiException

from fake_sdk import (
    FakeGeneratedSdk,
    make_api_error,
    make_state,
    make_work_item,
    raises,
)
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


TASK = "11111111-1111-1111-1111-111111111111"
PROJECT = "22222222-2222-2222-2222-222222222222"
STATE_DONE = "33333333-3333-3333-3333-333333333333"

# The exact structured 422 the sole-writer emits for an illegal Story move
# (``worktracker.workflow.InvalidTransition.as_body``). Kept verbatim here so a
# drift in the gate's rejection contract breaks this parity test loudly.
GATE_REJECTION = {
    "detail": "A Story cannot move 'Idea' → 'Done'.",
    "code": "illegal_transition",
    "from": "Idea",
    "to": "Done",
}


def _client_with_done_state():
    client = FakeGeneratedSdk()
    client.states.returns["list_states"] = [
        make_state(id=STATE_DONE, name="Done", group="completed")
    ]
    return client


def _gate_error(status_code, body):
    return make_api_error(status_code, body)


# --- happy path --------------------------------------------------------------


def test_update_task_status_returns_structured_success():
    client = _client_with_done_state()
    client.work_items.returns["update_work_item"] = make_work_item(id=TASK)
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task_status(PROJECT, TASK, "Done")

    assert result == {"ok": True, "task_id": TASK, "status": "Done"}
    name, args, _kwargs = client.work_items.calls[0]
    assert name == "update_work_item"
    assert args[0] == TASK and isinstance(args[1], WorkItemPatch)
    assert str(args[1].state_id) == STATE_DONE


def test_update_task_status_stamps_agent_origin_and_is_unforced():
    client = _client_with_done_state()
    client.work_items.returns["update_work_item"] = make_work_item(id=TASK)
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    service.update_task_status(PROJECT, TASK, "Done")

    _name, args, _kwargs = client.work_items.calls[0]
    assert args[1].origin == "agent"
    assert args[1].force is False


def test_update_task_status_unknown_state_returns_error():
    client = _client_with_done_state()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task_status(PROJECT, TASK, "Nonsense")

    assert result["ok"] is False
    assert "Nonsense" in result["error"]
    # No write attempted for an unresolved state name.
    assert client.work_items.calls == []


# --- illegal move: the gate's structured reason surfaces ---------------------


def test_update_task_status_surfaces_structured_rejection():
    client = _client_with_done_state()
    client.work_items.returns["update_work_item"] = raises(
        _gate_error(422, GATE_REJECTION)
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task_status(PROJECT, TASK, "Done")

    # Not raised, not a bare False — the machine-readable reason reaches the agent.
    assert result["ok"] is False
    assert result["task_id"] == TASK
    assert result["code"] == "illegal_transition"
    assert result["from"] == "Idea" and result["to"] == "Done"
    assert result["detail"] == GATE_REJECTION["detail"]


def test_update_task_status_reason_matches_gate_contract():
    """The tool returns the gate's structured body unchanged (parity door)."""

    client = _client_with_done_state()
    client.work_items.returns["update_work_item"] = raises(
        _gate_error(422, GATE_REJECTION)
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task_status(PROJECT, TASK, "Done")

    assert {k: result[k] for k in GATE_REJECTION} == GATE_REJECTION


def test_update_task_status_server_error_still_raises():
    client = _client_with_done_state()
    client.work_items.returns["update_work_item"] = raises(
        make_api_error(500, {"detail": "boom"})
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ApiException):
        service.update_task_status(PROJECT, TASK, "Done")


# --- registration ------------------------------------------------------------


def test_update_task_status_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "update_task_status" in tool_names


def test_update_task_status_tool_signature_is_public():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["update_task_status"]).parameters) == (
        "project_id",
        "task_id",
        "status_name",
    )
