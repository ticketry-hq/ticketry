"""Smoke coverage for root-mounted operations beside the generated SDK."""

import json

import pytest


ROOT = "11111111-1111-1111-1111-111111111111"
PROJECT = "22222222-2222-2222-2222-222222222222"
MODULE = "33333333-3333-3333-3333-333333333333"


class _StubHttpResponse:
    def __init__(self, status: int, body: bytes, reason: str) -> None:
        self.status = status
        self.data = body
        self.reason = reason
        self.headers = {"content-type": "application/json"}


def test_get_dependency_graph_uses_generated_transport_at_api_root() -> None:
    from worktracker_sdk import (
        ApiClient,
        Configuration,
        DependencyGraphOut,
        ExecutionApi,
    )

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            200,
            json.dumps(
                {
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
            ).encode(),
            "OK",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = request

    graph = ExecutionApi(client).get_dependency_graph(ROOT)

    assert isinstance(graph, DependencyGraphOut)
    assert graph.nodes[0].state == "Review"
    assert [(method, url) for method, url, _ in calls] == [
        ("GET", f"https://worktracker.test/api/work-items/{ROOT}/dependency-graph")
    ]


def test_execute_graph_uses_generated_transport_at_api_root() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi, GraphOut

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps(
                {
                    "root_id": ROOT,
                    "project_id": PROJECT,
                    "module_id": MODULE,
                    "agent": "codex",
                    "nodes": [],
                }
            ).encode(),
            "Created",
        )

    configuration = Configuration(
        host="https://worktracker.test/api/work-tracker",
        api_key={"ApiKeyAuth": "secret"},
    )
    client = ApiClient(configuration)
    client.rest_client.pool_manager.request = request

    graph = ExecutionApi(client).execute_graph(ROOT, agent="codex")

    assert isinstance(graph, GraphOut)
    assert graph.root_id == ROOT
    assert [(method, url) for method, url, _ in calls] == [
        ("POST", f"https://worktracker.test/api/work-items/{ROOT}/execute-graph")
    ]
    assert calls[0][2]["headers"]["x-api-key"] == "secret"
    assert json.loads(calls[0][2]["body"]) == {"agent": "codex"}


def test_reset_graph_uses_delete_at_api_root() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi, GraphOut

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            200,
            json.dumps(
                {
                    "root_id": ROOT,
                    "project_id": PROJECT,
                    "module_id": MODULE,
                    "agent": None,
                    "nodes": [],
                }
            ).encode(),
            "OK",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = request

    graph = ExecutionApi(client).reset_graph(ROOT)

    assert isinstance(graph, GraphOut)
    assert [(method, url) for method, url, _ in calls] == [
        ("DELETE", f"https://worktracker.test/api/work-items/{ROOT}/execute-graph")
    ]


def test_generate_leaf_llds_returns_typed_runs() -> None:
    from worktracker_sdk import (
        ApiClient,
        Configuration,
        ExecutionApi,
        GenerateLeafLldsOut,
    )

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps(
                {
                    "root_id": ROOT,
                    "runs": [
                        {
                            "task_id": MODULE,
                            "status": "running",
                            "agent_run_id": "run-1",
                            "error": None,
                        }
                    ],
                }
            ).encode(),
            "Created",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = request

    result = ExecutionApi(client).generate_leaf_llds(ROOT)

    assert isinstance(result, GenerateLeafLldsOut)
    assert result.runs[0].task_id == MODULE
    assert calls[0][1] == (
        f"https://worktracker.test/api/work-items/{ROOT}/generate-leaf-llds"
    )
    assert json.loads(calls[0][2]["body"]) == {}


def test_release_planning_run_returns_released_run() -> None:
    from worktracker_sdk import (
        ApiClient,
        Configuration,
        ExecutionApi,
        ReleasePlanningRunOut,
    )

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            200,
            json.dumps(
                {
                    "task_id": ROOT,
                    "status": "idle",
                    "released": {
                        "task_id": ROOT,
                        "project_id": PROJECT,
                        "module_id": MODULE,
                        "agent": "codex",
                        "phase": "refine",
                        "status": "running",
                        "agent_run_id": "run-1",
                        "error": None,
                    },
                }
            ).encode(),
            "OK",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = request

    result = ExecutionApi(client).release_planning_run(ROOT)

    assert isinstance(result, ReleasePlanningRunOut)
    assert result.status == "idle"
    assert result.released.phase == "refine"
    assert [(method, url) for method, url, _ in calls] == [
        ("DELETE", f"https://worktracker.test/api/work-items/{ROOT}/planning-run")
    ]


def test_default_coding_agent_returns_launched_agent() -> None:
    from worktracker_sdk import (
        ApiClient,
        Configuration,
        LaunchedAgentOut,
        LaunchApi,
    )

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps(
                {
                    "target_id": ROOT,
                    "agent": "claude",
                    "agent_run_id": "run-1",
                }
            ).encode(),
            "Created",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = request

    result = LaunchApi(client).default_coding_agent(ROOT, agent="claude")

    assert isinstance(result, LaunchedAgentOut)
    assert result.agent == "claude"
    assert [(method, url) for method, url, _ in calls] == [
        ("POST", f"https://worktracker.test/api/work-items/{ROOT}/launch-agent")
    ]
    assert json.loads(calls[0][2]["body"]) == {"agent": "claude"}


def test_root_operation_4xx_preserves_error_message_body() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi
    from worktracker_sdk.generated.exceptions import UnprocessableEntityException

    payload = {"error": "graph_empty", "message": "No implementation leaves"}
    client = ApiClient(Configuration(host="https://worktracker.test/api/work-tracker"))
    client.rest_client.pool_manager.request = lambda *args, **kwargs: _StubHttpResponse(
        422,
        json.dumps(payload).encode(),
        "Unprocessable Entity",
    )

    with pytest.raises(UnprocessableEntityException) as error:
        ExecutionApi(client).execute_graph(ROOT)

    assert error.value.data == payload
    assert json.loads(error.value.body) == payload
