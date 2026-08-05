"""The review-finding create tool — the agent-side public contract (#905).

The Story integration-review agent turns a finding into a direct Implementation
child born in the Implementation start stage through one dedicated call. This
suite proves the tool's two responsibilities: it renders the fixed ``Path`` /
inclusive ``Lines`` / optional ``Note`` evidence block and rejects malformed
evidence *before* any SDK write, and it surfaces the backend gate's rejection
(``detail``/``code``/``from``/``to``) rather than swallowing or raising it.
"""

import inspect

import pytest
from worktracker_sdk.generated import WorkItemCreate
from worktracker_sdk.generated.exceptions import ApiException

from fake_sdk import FakeGeneratedSdk, make_api_error, make_work_item, raises
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


PROJECT = "22222222-2222-2222-2222-222222222222"
PARENT = "11111111-1111-1111-1111-111111111111"
CHILD = "44444444-4444-4444-4444-444444444444"

# The structured 422 the backend finding gate emits for a parent not in Review
# (``worktracker.workflow.InvalidTransition.as_body``); kept verbatim so a drift
# in the gate contract breaks this parity test loudly.
GATE_REJECTION = {
    "detail": "A review finding's parent Story must be in Review.",
    "code": "parent_not_review",
    "from": "Implement",
    "to": "Implement",
}


def _service(client):
    return WorktrackerService(base_url="http://example.test", sdk=client)


def _gate_error(body):
    return make_api_error(422, body)


# --- happy path: evidence block is rendered and written ---------------------


def test_create_review_finding_builds_block_and_returns_ids():
    client = FakeGeneratedSdk()
    client.work_items.returns["create_work_item"] = make_work_item(
        id=CHILD, key="MEML-9"
    )
    service = _service(client)

    result = service.create_review_finding(
        PROJECT, PARENT, "Null deref", "src/loader.py", 10, 12, note="guard it"
    )

    assert result == {"ok": True, "task_id": CHILD, "key": "MEML-9"}
    name, args, _kwargs = client.work_items.calls[0]
    assert name == "create_work_item"
    payload = args[1]
    assert isinstance(payload, WorkItemCreate)
    assert str(payload.parent_id) == PARENT
    assert payload.issue_type_id is None
    assert payload.description == "Path: src/loader.py\nLines: 10-12\nNote: guard it"


def test_create_review_finding_omits_note_when_absent():
    client = FakeGeneratedSdk()
    client.work_items.returns["create_work_item"] = make_work_item(id=CHILD)
    service = _service(client)

    service.create_review_finding(PROJECT, PARENT, "F", "a.py", 5, 5)

    _name, args, _kwargs = client.work_items.calls[0]
    assert args[1].description == "Path: a.py\nLines: 5-5"


# --- malformed evidence: rejected before any write --------------------------


@pytest.mark.parametrize(
    "bad_path", ["", "   ", "/abs/path.py", "../escape.py", "a\nb.py"]
)
def test_create_review_finding_rejects_bad_path(bad_path):
    client = FakeGeneratedSdk()
    service = _service(client)

    result = service.create_review_finding(PROJECT, PARENT, "F", bad_path, 1, 2)

    assert result["ok"] is False
    assert result["code"] == "malformed_path"
    assert client.work_items.calls == []


@pytest.mark.parametrize("start,end", [(0, 3), (5, 2), (-1, 4), (3, 0)])
def test_create_review_finding_rejects_bad_range(start, end):
    client = FakeGeneratedSdk()
    service = _service(client)

    result = service.create_review_finding(PROJECT, PARENT, "F", "a.py", start, end)

    assert result["ok"] is False
    assert result["code"] == "malformed_range"
    assert client.work_items.calls == []


# --- backend gate rejection surfaces ----------------------------------------


def test_create_review_finding_surfaces_structured_rejection():
    client = FakeGeneratedSdk()
    client.work_items.returns["create_work_item"] = raises(_gate_error(GATE_REJECTION))
    service = _service(client)

    result = service.create_review_finding(PROJECT, PARENT, "F", "a.py", 1, 2)

    assert result["ok"] is False
    assert {k: result[k] for k in GATE_REJECTION} == GATE_REJECTION


def test_create_review_finding_server_error_still_raises():
    client = FakeGeneratedSdk()
    client.work_items.returns["create_work_item"] = raises(
        make_api_error(500, {"detail": "boom"})
    )
    service = _service(client)

    with pytest.raises(ApiException):
        service.create_review_finding(PROJECT, PARENT, "F", "a.py", 1, 2)


# --- registration -----------------------------------------------------------


def test_create_review_finding_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "create_review_finding" in tool_names


def test_create_review_finding_tool_signature_is_public():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["create_review_finding"]).parameters) == (
        "project_id",
        "parent_id",
        "name",
        "path",
        "line_start",
        "line_end",
        "note",
    )
