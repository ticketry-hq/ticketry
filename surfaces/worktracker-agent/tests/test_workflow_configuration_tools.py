"""MCP parity tests for the scoped per-type workflow operations."""

import inspect
from uuid import UUID

import pytest
from worktracker_sdk.generated import (
    AddWorkflowTransitionIn,
    ScopedLaunchBindingIn,
    ScopedWorkflowLaunchBindingOut,
    ScopedWorkflowOut,
    ScopedWorkflowTransitionOut,
    SetWorkflowAutoStartIn,
    SetWorkflowStartStateIn,
    SetWorkflowTransitionPermissionIn,
    WorkflowRevisionIn,
    WorkflowStandingWarningOut,
)
from worktracker_sdk.generated.exceptions import ApiException

from fake_sdk import FakeGeneratedSdk, make_api_error, raises
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


TYPE = "11111111-1111-1111-1111-111111111111"
READY = "22222222-2222-2222-2222-222222222222"
BUILD = "33333333-3333-3333-3333-333333333333"
DONE = "44444444-4444-4444-4444-444444444444"


def _workflow(revision=7):
    return ScopedWorkflowOut(
        issue_type_id=UUID(TYPE),
        start_state_id=UUID(READY),
        workflow_revision=revision,
        transitions=[
            ScopedWorkflowTransitionOut(
                from_state_id=UUID(READY),
                to_state_id=UUID(BUILD),
                agent_allowed=False,
            )
        ],
        launch_bindings=[
            ScopedWorkflowLaunchBindingOut(
                state_id=UUID(BUILD),
                prompt="Implement the ticket",
                agent="codex",
                auto_start=True,
            )
        ],
        warnings=[
            WorkflowStandingWarningOut(
                code="no_path_to_completed",
                state_id=UUID(BUILD),
                message="Build has no path to a completed state.",
            )
        ],
    )


def _service(operation, result=None):
    sdk = FakeGeneratedSdk()
    sdk.workflows.returns[operation] = result or _workflow()
    return WorktrackerService(base_url="http://example.test", sdk=sdk), sdk


def test_read_returns_permissions_auto_start_and_standing_warnings():
    service, sdk = _service("get_issue_type_workflow_settings")

    result = service.get_issue_type_workflow_settings(TYPE)

    assert result.transitions[0].agent_allowed is False
    assert result.launch_bindings[0].auto_start is True
    assert result.warnings[0].code == "no_path_to_completed"
    assert sdk.workflows.calls[0][1] == (UUID(TYPE),)


@pytest.mark.parametrize(
    ("method", "args", "operation", "body_type", "body_fields"),
    [
        (
            "add_issue_type_workflow_transition",
            (TYPE, READY, BUILD, 7, False),
            "add_issue_type_workflow_transition",
            AddWorkflowTransitionIn,
            {
                "from_state_id": UUID(READY),
                "to_state_id": UUID(BUILD),
                "agent_allowed": False,
                "workflow_revision": 7,
            },
        ),
        (
            "remove_issue_type_workflow_transition",
            (TYPE, READY, BUILD, 7),
            "remove_issue_type_workflow_transition",
            WorkflowRevisionIn,
            {"workflow_revision": 7},
        ),
        (
            "set_issue_type_workflow_transition_permission",
            (TYPE, READY, BUILD, False, 7),
            "set_issue_type_workflow_transition_permission",
            SetWorkflowTransitionPermissionIn,
            {"agent_allowed": False, "workflow_revision": 7},
        ),
        (
            "set_issue_type_workflow_start_state",
            (TYPE, BUILD, 7),
            "set_issue_type_workflow_start_state",
            SetWorkflowStartStateIn,
            {"state_id": UUID(BUILD), "workflow_revision": 7},
        ),
        (
            "upsert_issue_type_workflow_launch_binding",
            (TYPE, BUILD, 7, "Implement", "codex", "gpt-5", "high"),
            "upsert_issue_type_workflow_launch_binding",
            ScopedLaunchBindingIn,
            {
                "prompt": "Implement",
                "agent": "codex",
                "model": "gpt-5",
                "reasoning": "high",
                "workflow_revision": 7,
            },
        ),
        (
            "clear_issue_type_workflow_launch_binding",
            (TYPE, BUILD, 7),
            "clear_issue_type_workflow_launch_binding",
            WorkflowRevisionIn,
            {"workflow_revision": 7},
        ),
        (
            "set_issue_type_workflow_auto_start",
            (TYPE, BUILD, True, 7),
            "set_issue_type_workflow_auto_start",
            SetWorkflowAutoStartIn,
            {"auto_start": True, "workflow_revision": 7},
        ),
    ],
)
def test_write_maps_one_to_one_to_scoped_rest_operation(
    method, args, operation, body_type, body_fields
):
    service, sdk = _service(operation, _workflow(8))

    result = getattr(service, method)(*args)

    assert result.workflow_revision == 8
    _name, call_args, _kwargs = sdk.workflows.calls[0]
    body = call_args[-1]
    assert isinstance(body, body_type)
    for field, expected in body_fields.items():
        assert getattr(body, field) == expected


@pytest.mark.parametrize(
    ("operation", "method", "args", "status", "detail"),
    [
        (
            "set_issue_type_workflow_start_state",
            "set_issue_type_workflow_start_state",
            (TYPE, DONE, 6),
            409,
            "Workflow revision is stale; read the current workflow and retry.",
        ),
        (
            "set_issue_type_workflow_auto_start",
            "set_issue_type_workflow_auto_start",
            (TYPE, BUILD, True, 7),
            422,
            "Configure a launch binding before changing auto-start.",
        ),
    ],
)
def test_write_surfaces_service_rejection(operation, method, args, status, detail):
    service, sdk = _service(operation)
    sdk.workflows.returns[operation] = raises(
        make_api_error(status, {"detail": detail})
    )

    result = getattr(service, method)(*args)

    assert result == {"ok": False, "detail": detail}


def test_workflow_server_error_still_raises():
    service, sdk = _service("get_issue_type_workflow_settings")
    sdk.workflows.returns["get_issue_type_workflow_settings"] = raises(
        make_api_error(500, {"detail": "boom"})
    )

    with pytest.raises(ApiException):
        service.get_issue_type_workflow_settings(TYPE)


def test_workflow_configuration_tools_are_registered_with_public_signatures():
    tools = dict(generate_worktracker_tools())
    expected = {
        "get_issue_type_workflow_settings": ("type_id",),
        "add_issue_type_workflow_transition": (
            "type_id",
            "from_state_id",
            "to_state_id",
            "workflow_revision",
            "agent_allowed",
        ),
        "remove_issue_type_workflow_transition": (
            "type_id",
            "from_state_id",
            "to_state_id",
            "workflow_revision",
        ),
        "set_issue_type_workflow_transition_permission": (
            "type_id",
            "from_state_id",
            "to_state_id",
            "agent_allowed",
            "workflow_revision",
        ),
        "set_issue_type_workflow_start_state": (
            "type_id",
            "state_id",
            "workflow_revision",
        ),
        "upsert_issue_type_workflow_launch_binding": (
            "type_id",
            "state_id",
            "workflow_revision",
            "prompt",
            "agent",
            "model",
            "reasoning",
        ),
        "clear_issue_type_workflow_launch_binding": (
            "type_id",
            "state_id",
            "workflow_revision",
        ),
        "set_issue_type_workflow_auto_start": (
            "type_id",
            "state_id",
            "auto_start",
            "workflow_revision",
        ),
    }

    for name, parameters in expected.items():
        assert tuple(inspect.signature(tools[name]).parameters) == parameters
