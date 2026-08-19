"""MCP exposure and delegation coverage for the composed Run Now capability."""

import worktracker_agent.api.tools as tools_module

from fake_sdk import FakeGeneratedSdk, make_api_error, make_run_now, raises
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.api.tools import WorktrackerToolset
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools
from worktracker_sdk.generated import RunNowRefusal


TARGET = "44444444-4444-4444-4444-444444444444"


def _service(client=None):
    return WorktrackerService(
        base_url="http://example.test/api/work-tracker",
        sdk=client,
    )


def test_run_now_accepts_a_key_and_delegates_with_agent_origin(monkeypatch):
    client = FakeGeneratedSdk()
    client.execution.returns["run_now"] = make_run_now()
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda _value: TARGET)

    result = service.run_now("MEML-9", authorization="Bearer signed-run")

    assert result["committed_state"]["name"] == "Implement"
    assert result["run"]["agent_run_id"] == "run-1"
    assert client.execution.calls == [
        (
            "run_now",
            (TARGET,),
            {"origin": "agent", "authorization": "Bearer signed-run"},
        )
    ]


def test_run_now_tool_forwards_the_request_run_identity(monkeypatch):
    class Service:
        def __init__(self):
            self.calls = []

        def run_now(self, id_or_key, *, authorization=None):
            self.calls.append((id_or_key, authorization))
            return {"target_id": id_or_key}

    service = Service()
    monkeypatch.setattr(
        tools_module,
        "_request_authorization",
        lambda: "Bearer signed-caller",
    )

    result = WorktrackerToolset(service=service).run_now_tool(None, "MEML-9")

    assert result == {"target_id": "MEML-9"}
    assert service.calls == [("MEML-9", "Bearer signed-caller")]


def test_run_now_returns_backend_refusal_structurally(monkeypatch):
    client = FakeGeneratedSdk()
    refusal = {
        "target_id": TARGET,
        "committed_state": None,
        "run": None,
        "detail": "task_already_active",
        "code": "task_already_active",
    }
    client.execution.returns["run_now"] = raises(make_api_error(409, refusal))
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda _value: TARGET)

    assert service.run_now(TARGET) == refusal


def test_run_now_returns_typed_late_launch_failure_structurally(monkeypatch):
    client = FakeGeneratedSdk()
    refusal = {
        "target_id": TARGET,
        "committed_state": {
            "id": "77777777-7777-7777-7777-777777777777",
            "name": "Implement",
        },
        "run": None,
        "detail": "launch_unavailable",
        "code": "launch_unavailable",
    }
    error = make_api_error(503, refusal)
    error.data = RunNowRefusal.model_validate(refusal)
    client.execution.returns["run_now"] = raises(error)
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda _value: TARGET)

    assert service.run_now(TARGET) == refusal


def test_run_now_returns_unknown_key_structurally(monkeypatch):
    client = FakeGeneratedSdk()
    service = _service(client)
    monkeypatch.setattr(
        service,
        "_sdk_resolve_task_id",
        raises(make_api_error(404, {"detail": "Work item not found."})),
    )

    assert service.run_now("MEML-404") == {
        "target_id": "MEML-404",
        "committed_state": None,
        "run": None,
        "detail": "Work item not found.",
        "code": "Work item not found.",
    }


def test_run_now_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "run_now" in tool_names
