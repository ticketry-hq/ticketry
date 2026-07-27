"""Tests for the default coding-agent launch MCP tool (#924).

The ``launch_default_coding_agent`` tool routes through the SDK's rooted launch
resource (mounted at the API *root*, not under ``/work-tracker``), resolves the
target key→id, surfaces the typed body as a dict, folds a 4xx into a clean
``{target_id, error}`` result read off the generated exception body, and re-raises a
5xx. Plus tool registration.
"""

import pytest
from worktracker_sdk.generated.exceptions import ApiException, NotFoundException

from fake_sdk import FakeGeneratedSdk, make_api_error, make_launched_agent, raises
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


ROOT = "11111111-1111-1111-1111-111111111111"
TARGET = "44444444-4444-4444-4444-444444444444"


def _service(client=None):
    return WorktrackerService(
        base_url="http://example.test/api/work-tracker", sdk=client
    )


def _sdk_error(status_code, error, error_type=ApiException):
    return make_api_error(status_code, {"error": error, "message": error}, error_type)


def test_launch_routes_through_sdk_and_returns_facts(monkeypatch):
    client = FakeGeneratedSdk()
    client.launch.returns["default_coding_agent"] = make_launched_agent(
        target_id=TARGET, agent="codex", agent_run_id="run-1"
    )
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda value: value)

    result = service.launch_default_coding_agent(TARGET)

    # Routed through the rooted launch resource; the backend resolves the binding.
    assert [c[0] for c in client.launch.calls] == ["default_coding_agent"]
    _name, args, _kwargs = client.launch.calls[0]
    assert str(args[0]) == TARGET
    assert result == {
        "target_id": TARGET,
        "agent": "codex",
        "agent_run_id": "run-1",
    }


def test_launch_resolves_key_to_target_id(monkeypatch):
    client = FakeGeneratedSdk()
    client.launch.returns["default_coding_agent"] = make_launched_agent(
        target_id=TARGET
    )
    service = _service(client)
    # A key resolves to the target UUID before the launch call.
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda value: TARGET)

    result = service.launch_default_coding_agent("MEML-9")

    _name, args, _kwargs = client.launch.calls[0]
    assert str(args[0]) == TARGET
    assert result["target_id"] == TARGET


def test_launch_4xx_returns_clean_error(monkeypatch):
    client = FakeGeneratedSdk()
    client.launch.returns["default_coding_agent"] = raises(
        _sdk_error(404, "task_not_found", NotFoundException)
    )
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda value: value)

    result = service.launch_default_coding_agent(TARGET)

    assert result == {"target_id": TARGET, "error": "task_not_found"}


def test_launch_no_module_ancestry_returns_clean_error(monkeypatch):
    client = FakeGeneratedSdk()
    client.launch.returns["default_coding_agent"] = raises(
        _sdk_error(422, "module_id_required")
    )
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda value: value)

    result = service.launch_default_coding_agent(TARGET)

    assert result == {"target_id": TARGET, "error": "module_id_required"}


def test_launch_5xx_propagates(monkeypatch):
    client = FakeGeneratedSdk()
    client.launch.returns["default_coding_agent"] = raises(
        _sdk_error(503, "launch_unavailable")
    )
    service = _service(client)
    monkeypatch.setattr(service, "_sdk_resolve_task_id", lambda value: value)

    with pytest.raises(ApiException):
        service.launch_default_coding_agent(TARGET)


def test_launch_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "launch_default_coding_agent" in tool_names
