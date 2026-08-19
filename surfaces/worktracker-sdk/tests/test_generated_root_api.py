"""Smoke coverage for resource operations in the generated SDK contract."""

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

    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = request

    graph = ExecutionApi(client).get_dependency_graph(ROOT)

    assert isinstance(graph, DependencyGraphOut)
    assert graph.nodes[0].state == "Review"
    assert [(method, url) for method, url, _ in calls] == [
        ("GET", f"https://worktracker.test/api/work-tracker/work-items/{ROOT}/graph-run")
    ]


def test_execute_graph_uses_generated_transport_at_api_root() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecuteGraphOut, ExecutionApi

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps(
                {
                    "root_id": ROOT,
                    "launched": [MODULE],
                }
            ).encode(),
            "Created",
        )

    configuration = Configuration(
        host="https://worktracker.test/api",
        api_key={"ApiKeyAuth": "secret"},
    )
    client = ApiClient(configuration)
    client.rest_client.pool_manager.request = request

    result = ExecutionApi(client).execute_graph(ROOT, agent="codex")

    assert isinstance(result, ExecuteGraphOut)
    assert result.root_id == ROOT
    assert result.launched == [MODULE]
    assert [(method, url) for method, url, _ in calls] == [
        ("POST", f"https://worktracker.test/api/work-tracker/work-items/{ROOT}/graph-run")
    ]
    assert calls[0][2]["headers"]["x-api-key"] == "secret"
    assert json.loads(calls[0][2]["body"]) == {"agent": "codex"}


@pytest.mark.parametrize(
    "mode,expected_body",
    [
        (None, {"agent": "codex"}),
        ("parallel", {"agent": "codex", "mode": "parallel"}),
        ("serial", {"agent": "codex", "mode": "serial"}),
    ],
    ids=["omitted", "parallel", "serial"],
)
def test_execute_graph_serializes_the_requested_execution_mode(
    mode, expected_body
) -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps({"root_id": ROOT, "launched": []}).encode(),
            "Created",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = request

    ExecutionApi(client).execute_graph(ROOT, agent="codex", mode=mode)

    assert json.loads(calls[0][2]["body"]) == expected_body


def test_reset_graph_uses_delete_at_api_root() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi, ResetGraphOut

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            200,
            json.dumps(
                {
                    "root_id": ROOT,
                    "cleared": [MODULE],
                }
            ).encode(),
            "OK",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = request

    result = ExecutionApi(client).reset_graph(ROOT)

    assert isinstance(result, ResetGraphOut)
    assert result.cleared == [MODULE]
    assert [(method, url) for method, url, _ in calls] == [
        ("DELETE", f"https://worktracker.test/api/work-tracker/work-items/{ROOT}/graph-run")
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

    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = request

    result = LaunchApi(client).default_coding_agent(ROOT, agent="claude")

    assert isinstance(result, LaunchedAgentOut)
    assert result.agent == "claude"
    assert [(method, url) for method, url, _ in calls] == [
        ("POST", f"https://worktracker.test/api/work-tracker/work-items/{ROOT}/launch-agent")
    ]
    assert json.loads(calls[0][2]["body"]) == {"agent": "claude"}


def test_run_now_returns_the_committed_state_and_launched_run() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi, RunNowOut

    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _StubHttpResponse(
            201,
            json.dumps(
                {
                    "target_id": ROOT,
                    "committed_state": {"id": MODULE, "name": "Implement"},
                    "run": {
                        "target_id": ROOT,
                        "agent": "codex",
                        "agent_run_id": "run-1",
                    },
                }
            ).encode(),
            "Created",
        )

    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = request

    result = ExecutionApi(client).run_now(
        ROOT,
        origin="agent",
        authorization="Bearer signed-caller",
    )

    assert isinstance(result, RunNowOut)
    assert result.committed_state.name == "Implement"
    assert result.run.agent_run_id == "run-1"
    assert [(method, url) for method, url, _ in calls] == [
        ("POST", f"https://worktracker.test/api/work-tracker/work-items/{ROOT}/run-now")
    ]
    assert calls[0][2]["headers"]["Authorization"] == "Bearer signed-caller"
    assert json.loads(calls[0][2]["body"]) == {"origin": "agent"}


def test_run_now_refusal_deserializes_the_partial_outcome_model() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi
    from worktracker_sdk.generated import RunNowRefusal
    from worktracker_sdk.generated.exceptions import ApiException

    payload = {
        "target_id": ROOT,
        "committed_state": {"id": MODULE, "name": "Implement"},
        "run": None,
        "detail": "launch_unavailable",
        "code": "launch_unavailable",
    }
    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = lambda *args, **kwargs: _StubHttpResponse(
        503,
        json.dumps(payload).encode(),
        "Service Unavailable",
    )

    with pytest.raises(ApiException) as error:
        ExecutionApi(client).run_now(ROOT, origin="agent")

    assert isinstance(error.value.data, RunNowRefusal)
    assert error.value.data.committed_state.name == "Implement"
    assert error.value.data.run is None


def test_root_operation_4xx_preserves_error_message_body() -> None:
    from worktracker_sdk import ApiClient, Configuration, ExecutionApi
    from worktracker_sdk.generated.exceptions import UnprocessableEntityException

    payload = {"error": "graph_empty", "message": "No implementation leaves"}
    client = ApiClient(Configuration(host="https://worktracker.test/api"))
    client.rest_client.pool_manager.request = lambda *args, **kwargs: _StubHttpResponse(
        422,
        json.dumps(payload).encode(),
        "Unprocessable Entity",
    )

    with pytest.raises(UnprocessableEntityException) as error:
        ExecutionApi(client).execute_graph(ROOT)

    assert error.value.data == payload
    assert json.loads(error.value.body) == payload
