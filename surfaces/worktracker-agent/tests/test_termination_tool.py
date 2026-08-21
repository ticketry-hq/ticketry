"""Behavior of the run-scoped, zero-argument MCP termination tool."""

import asyncio
import inspect

import httpx

import worktracker_agent.mcp.termination as termination
from worktracker_agent.api.run_control import StudioRunControlService


class _TerminationService:
    def __init__(self):
        self.authorizations = []

    def terminate_current_run(self, authorization):
        self.authorizations.append(authorization)
        return {
            "ok": True,
            "terminated": True,
            "already_terminated": False,
            "agent_run_id": "run-1",
        }


def test_terminate_current_run_is_zero_argument_and_forwards_request_identity(
    monkeypatch,
):
    service = _TerminationService()
    monkeypatch.setattr(termination, "get_studio_run_control_service", lambda: service)
    monkeypatch.setattr(
        termination,
        "_request_authorization",
        lambda: "Bearer signed-run-1",
    )

    result = termination.terminate_current_run()

    assert list(inspect.signature(termination.terminate_current_run).parameters) == []
    assert service.authorizations == ["Bearer signed-run-1"]
    assert result == {
        "ok": True,
        "terminated": True,
        "already_terminated": False,
        "agent_run_id": "run-1",
    }


def test_fastmcp_registers_termination_with_an_empty_input_schema():
    from worktracker_agent.mcp.server import mcp

    registered = asyncio.run(mcp.get_tool("terminate_current_run"))

    assert registered is not None
    assert registered.parameters == {
        "additionalProperties": False,
        "properties": {},
        "type": "object",
    }


def test_termination_service_forwards_authorization_to_studio():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "ok": True,
                "terminated": True,
                "already_terminated": False,
                "agent_run_id": "run-1",
            },
        )

    service = StudioRunControlService(
        url="http://studio.test/api/terminals/self-terminate",
        transport=httpx.MockTransport(handler),
    )

    result = service.terminate_current_run("Bearer signed-run-1")

    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/api/terminals/self-terminate"
    assert seen[0].headers["Authorization"] == "Bearer signed-run-1"
    assert result == {
        "ok": True,
        "terminated": True,
        "already_terminated": False,
        "agent_run_id": "run-1",
    }


def test_termination_service_missing_identity_makes_no_outbound_request():
    def handler(request):
        raise AssertionError("missing identity must not reach Studio")

    service = StudioRunControlService(
        url="http://studio.test/api/terminals/self-terminate",
        transport=httpx.MockTransport(handler),
    )

    assert service.terminate_current_run(None) == {
        "ok": False,
        "error": "caller_run_unbound",
        "reason": "authorization_missing",
    }


def test_termination_service_preserves_structured_studio_failure():
    service = StudioRunControlService(
        url="http://studio.test/api/terminals/self-terminate",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                401,
                json={
                    "ok": False,
                    "error": "caller_run_unbound",
                    "reason": "authorization_invalid",
                },
            )
        ),
    )

    assert service.terminate_current_run("Bearer bad-signature") == {
        "ok": False,
        "error": "caller_run_unbound",
        "reason": "authorization_invalid",
    }


def test_termination_service_states_a_refusal_as_not_ok():
    """Studio's DRF error body has no ``ok`` flag; the agent's result must."""

    service = StudioRunControlService(
        url="http://studio.test/api/terminals/self-terminate",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                409,
                json={
                    "detail": "run_owned_by_other_runtime",
                    "code": "run_owned_by_other_runtime",
                    "owner_runtime": "tmux-other-instance",
                },
            )
        ),
    )

    assert service.terminate_current_run("Bearer signed-run-1") == {
        "ok": False,
        "error": "run_owned_by_other_runtime",
        "detail": "run_owned_by_other_runtime",
        "code": "run_owned_by_other_runtime",
        "owner_runtime": "tmux-other-instance",
    }
