"""MCP parity tests for workflow tools assembled from the CRUD contract."""

import inspect
from types import SimpleNamespace
from uuid import UUID

from worktracker_sdk.generated import (
    IssueTypeTransitionCreate,
    LaunchBindingWrite,
    PatchedIssueType,
    PatchedIssueTypeTransition,
)

from fake_sdk import FakeGeneratedSdk
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


TYPE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
READY = UUID("22222222-2222-2222-2222-222222222222")
BUILD = UUID("33333333-3333-3333-3333-333333333333")
DONE = UUID("44444444-4444-4444-4444-444444444444")
PROVIDER = UUID("55555555-5555-5555-5555-555555555555")
MODEL = UUID("66666666-6666-6666-6666-666666666666")
REASONING = UUID("77777777-7777-7777-7777-777777777777")


def _sdk():
    sdk = FakeGeneratedSdk()
    sdk.issue_types.returns["get_issue_type"] = SimpleNamespace(
        id=TYPE,
        project=PROJECT,
        start_state=READY,
        workflow_revision=7,
    )
    sdk.states.returns["list_states"] = [
        SimpleNamespace(id=READY, name="Ready", group="unstarted"),
        SimpleNamespace(id=BUILD, name="Build", group="started"),
        SimpleNamespace(id=DONE, name="Done", group="completed"),
    ]
    sdk.workflows.returns["list_issue_type_transitions"] = [
        SimpleNamespace(
            id=1,
            issue_type=TYPE,
            from_state=READY,
            to_state=BUILD,
            agent_allowed=False,
        ),
        SimpleNamespace(
            id=2,
            issue_type=TYPE,
            from_state=BUILD,
            to_state=DONE,
            agent_allowed=True,
        ),
    ]
    sdk.providers.returns["list_providers"] = [
        SimpleNamespace(id=PROVIDER, slug="codex", activated=True)
    ]
    sdk.models.returns["list_agent_models"] = [
        SimpleNamespace(id=MODEL, provider=PROVIDER, name="gpt-5")
    ]
    sdk.reasoning_levels.returns["list_reasoning_levels"] = [
        SimpleNamespace(id=REASONING, name="high")
    ]
    sdk.launch_bindings.returns["list_launch_bindings"] = [
        SimpleNamespace(
            id=3,
            issue_type=TYPE,
            state=BUILD,
            prompt="Implement",
            required_skills=["tdd"],
            entry_skill=None,
            model=MODEL,
            reasoning=REASONING,
            auto_start=True,
            subtree_run_enabled=False,
            created_at=None,
            updated_at=None,
            model_dump=lambda: {
                "id": 3,
                "issue_type": TYPE,
                "state": BUILD,
                "prompt": "Implement",
                "required_skills": ["tdd"],
                "entry_skill": None,
                "model": MODEL,
                "reasoning": REASONING,
                "auto_start": True,
                "subtree_run_enabled": False,
                "created_at": None,
                "updated_at": None,
            },
        )
    ]
    return sdk


def test_read_assembles_the_legacy_tool_shape_from_crud_rows():
    sdk = _sdk()
    service = WorktrackerService(base_url="http://example.test", sdk=sdk)

    result = service.get_issue_type_workflow_settings(str(TYPE))

    assert result["workflow_revision"] == 7
    assert result["transitions"][0] == {
        "from_state_id": READY,
        "to_state_id": BUILD,
        "agent_allowed": False,
    }
    assert result["launch_bindings"][0]["agent"] == "codex"
    assert result["launch_bindings"][0]["model"] == "gpt-5"
    assert result["launch_bindings"][0]["entry_skill"] is None
    assert result["warnings"] == []


def test_read_warns_when_user_invoke_only_skill_is_not_the_entry():
    sdk = _sdk()
    binding = sdk.launch_bindings.returns["list_launch_bindings"][0]
    binding.required_skills = ["to-spec", "tdd"]
    binding.entry_skill = None

    result = WorktrackerService(
        base_url="http://example.test", sdk=sdk
    ).get_issue_type_workflow_settings(str(TYPE))

    warning = next(
        item
        for item in result["warnings"]
        if item["code"] == "user_invoke_only_skill_not_entry"
    )
    assert "to-spec" in warning["message"]
    assert "tdd" not in warning["message"]


def test_transition_writes_use_the_crud_operations_and_revision_bodies():
    sdk = _sdk()
    service = WorktrackerService(base_url="http://example.test", sdk=sdk)

    service.add_issue_type_workflow_transition(
        str(TYPE), str(READY), str(BUILD), 7, False
    )
    service.set_issue_type_workflow_transition_permission(
        str(TYPE), str(READY), str(BUILD), False, 7
    )
    service.remove_issue_type_workflow_transition(str(TYPE), str(READY), str(BUILD), 7)

    create_body = sdk.workflows.calls[0][1][1]
    assert isinstance(create_body, IssueTypeTransitionCreate)
    assert create_body.from_state == READY
    update_body = sdk.workflows.calls[1][1][3]
    assert isinstance(update_body, PatchedIssueTypeTransition)
    assert update_body.workflow_revision == 7
    assert sdk.revisioned_delete.calls[0][0] == "delete_transition"
    assert sdk.revisioned_delete.calls[0][1] == (TYPE, READY, BUILD, 7)


def test_start_state_moves_through_issue_type_update():
    sdk = _sdk()
    service = WorktrackerService(base_url="http://example.test", sdk=sdk)

    service.set_issue_type_workflow_start_state(str(TYPE), str(BUILD), 7)

    body = sdk.issue_types.calls[-1][1][1]
    assert isinstance(body, PatchedIssueType)
    assert body.start_state == BUILD
    assert body.workflow_revision == 7


def test_launch_binding_tool_resolves_catalog_rows_without_changing_arguments():
    sdk = _sdk()
    service = WorktrackerService(base_url="http://example.test", sdk=sdk)

    service.upsert_issue_type_workflow_launch_binding(
        str(TYPE),
        str(BUILD),
        7,
        "Next prompt",
        "codex",
        "gpt-5",
        "high",
        ["to-spec"],
        "to-spec",
    )

    _, args, _ = sdk.launch_bindings.calls[-1]
    assert args[:2] == (BUILD, TYPE)
    body = args[2]
    assert isinstance(body, LaunchBindingWrite)
    assert body.model == MODEL
    assert body.reasoning == REASONING
    assert body.entry_skill == "to-spec"
    assert body.auto_start is True


def test_auto_start_and_clear_reuse_the_composite_launch_binding_resource():
    sdk = _sdk()
    service = WorktrackerService(base_url="http://example.test", sdk=sdk)

    service.set_issue_type_workflow_auto_start(str(TYPE), str(BUILD), False, 7)
    service.clear_issue_type_workflow_launch_binding(str(TYPE), str(BUILD), 8)

    body = sdk.launch_bindings.calls[-1][1][2]
    assert body.auto_start is False
    assert body.workflow_revision == 7
    assert sdk.revisioned_delete.calls[-1][1] == (TYPE, BUILD, 8)


def test_workflow_configuration_tools_keep_their_public_signatures():
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
            "required_skills",
            "entry_skill",
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
