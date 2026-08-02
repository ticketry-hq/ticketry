"""Tests for the MCP execution trigger surface (#721).

Cover the graph tools: they route through the SDK's rooted execution
resource (mounted at the API *root*, not under ``/work-tracker`` — #894), pass
the agent, surface the typed body as a dict, and fold a 4xx into a clean
``{root_id/task_id, error}`` result read off the generated exception body. Plus
tool registration.
"""

import inspect

import pytest
from worktracker_sdk.generated.exceptions import ApiException, NotFoundException

from fake_sdk import (
    DependencyGraphNodeOut,
    DependencyGraphOut,
    FakeGeneratedSdk,
    GraphNodeOut,
    GraphOut,
    make_api_error,
    raises,
)
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.api.tools import WorktrackerToolset
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


ROOT = "11111111-1111-1111-1111-111111111111"
A = "22222222-2222-2222-2222-222222222222"
B = "33333333-3333-3333-3333-333333333333"


def _service(client=None):
    return WorktrackerService(
        base_url="http://example.test/api/work-tracker", sdk=client
    )


def _sdk_error(status_code, error, error_type=ApiException):
    return make_api_error(status_code, {"error": error, "message": error}, error_type)


# --- execute_dependency_graph -------------------------------------------------


def test_get_dependency_graph_tool_returns_leaf_read_through_sdk_without_launching():
    client = FakeGeneratedSdk()
    client.execution.returns["get_dependency_graph"] = DependencyGraphOut(
        root_id=ROOT,
        nodes=[
            DependencyGraphNodeOut(
                id=ROOT, state="Review", parent_id=None, blocked_by=[]
            )
        ],
    )
    toolset = WorktrackerToolset(_service(client))

    result = toolset.get_dependency_graph_tool(None, ROOT)

    assert result == {
        "root_id": ROOT,
        "nodes": [
            {
                "id": ROOT,
                "state": "Review",
                "parent_id": None,
                "blocked_by": [],
            }
        ],
    }


def test_get_dependency_graph_unknown_root_returns_clean_error():
    client = FakeGeneratedSdk()
    client.execution.returns["get_dependency_graph"] = raises(
        _sdk_error(404, "task_not_found", NotFoundException)
    )
    toolset = WorktrackerToolset(_service(client))

    result = toolset.get_dependency_graph_tool(None, ROOT)

    assert result == {"root_id": ROOT, "error": "task_not_found"}


def test_get_dependency_graph_unknown_key_returns_clean_error():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = raises(
        _sdk_error(404, "task_not_found", NotFoundException)
    )
    toolset = WorktrackerToolset(_service(client))

    result = toolset.get_dependency_graph_tool(None, "MEML-404")

    assert result == {"root_id": "MEML-404", "error": "task_not_found"}


def test_execute_dependency_graph_routes_through_sdk():
    client = FakeGeneratedSdk()
    client.execution.returns["execute_graph"] = GraphOut(
        root_id=ROOT,
        project_id=B,
        module_id=B,
        agent="codex",
        nodes=[GraphNodeOut(task_id=A, status="running", agent_run_id="run-1")],
    )
    service = _service(client)

    result = service.execute_dependency_graph(ROOT)

    # Routed through the rooted execution resource with no provider override.
    # projected back to the exact dict shape the tool has always returned.
    assert [c[0] for c in client.execution.calls] == ["execute_graph"]
    _name, args, _kwargs = client.execution.calls[0]
    assert str(args[0]) == ROOT and args[1] is None
    assert result["root_id"] == ROOT
    assert result["nodes"][0]["status"] == "running"
    assert result["nodes"][0]["agent_run_id"] == "run-1"


def test_execute_dependency_graph_passes_agent():
    client = FakeGeneratedSdk()
    client.execution.returns["execute_graph"] = GraphOut(
        root_id=ROOT, project_id=B, module_id=B, agent="claude", nodes=[]
    )
    service = _service(client)

    service.execute_dependency_graph(ROOT, agent="claude")

    _name, args, _kwargs = client.execution.calls[0]
    assert args[1] == "claude"


def test_execute_dependency_graph_reset_rearms_then_executes():
    client = FakeGeneratedSdk()
    client.execution.returns["reset_graph"] = GraphOut(
        root_id=ROOT,
        project_id=B,
        module_id=B,
        nodes=[GraphNodeOut(task_id=A, status="idle")],
    )
    client.execution.returns["execute_graph"] = GraphOut(
        root_id=ROOT,
        project_id=B,
        module_id=B,
        nodes=[GraphNodeOut(task_id=A, status="running", agent_run_id="run-2")],
    )
    service = _service(client)
    toolset = WorktrackerToolset(service)

    result = toolset.execute_dependency_graph_tool(None, ROOT, reset=True)

    assert [call[0] for call in client.execution.calls] == [
        "reset_graph",
        "execute_graph",
    ]
    assert result["nodes"][0]["status"] == "running"
    assert result["nodes"][0]["agent_run_id"] == "run-2"


def test_execute_dependency_graph_default_preserves_recorded_failure():
    client = FakeGeneratedSdk()
    client.execution.returns["execute_graph"] = GraphOut(
        root_id=ROOT,
        project_id=B,
        module_id=B,
        nodes=[GraphNodeOut(task_id=A, status="failed", error="agent_not_configured")],
    )
    toolset = WorktrackerToolset(_service(client))

    result = toolset.execute_dependency_graph_tool(None, ROOT)

    assert [call[0] for call in client.execution.calls] == ["execute_graph"]
    assert result["nodes"][0]["status"] == "failed"
    assert result["nodes"][0]["error"] == "agent_not_configured"


def test_execute_dependency_graph_4xx_returns_clean_error():
    client = FakeGeneratedSdk()
    client.execution.returns["execute_graph"] = raises(_sdk_error(422, "graph_empty"))
    service = _service(client)

    result = service.execute_dependency_graph(ROOT)

    assert result == {"root_id": ROOT, "error": "graph_empty"}


def test_execute_dependency_graph_5xx_propagates():
    client = FakeGeneratedSdk()
    client.execution.returns["execute_graph"] = raises(_sdk_error(500, "boom"))
    service = _service(client)

    with pytest.raises(ApiException):
        service.execute_dependency_graph(ROOT)


# --- Registration -------------------------------------------------------------


def test_execution_tools_are_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert {
        "get_dependency_graph",
        "execute_dependency_graph",
    } <= tool_names
    assert {
        "start_orchestration_run",
        "get_orchestration_run_status",
        "release_orchestration_run",
        "kill_all_orchestration_runs",
    }.isdisjoint(tool_names)


def test_execute_dependency_graph_tool_exposes_reset_recovery_contract():
    tools = dict(generate_worktracker_tools())
    tool = tools["execute_dependency_graph"]
    doc = " ".join(inspect.getdoc(tool).split())

    assert tuple(inspect.signature(tool).parameters) == (
        "root_task_id",
        "agent",
        "reset",
    )
    assert "reset=True" in doc
    assert "preserves recorded failures" in doc
