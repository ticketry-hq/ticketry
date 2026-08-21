"""MCP integration coverage for revision-guarded workflow configuration."""

import uuid

import pytest

from worktracker.models import AgentModel, IssueType, Provider, State


@pytest.fixture
def mcp_workflow(project):
    states = {
        name: State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            sort_order=sort_order,
        )
        for sort_order, (name, group) in enumerate(
            (("Ready", "unstarted"), ("Build", "started"), ("Done", "completed"))
        )
    }
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        start_state=states["Ready"],
    )
    model = AgentModel.objects.create(
        provider=Provider.objects.get(slug="codex"),
        name="integration-model",
    )
    return issue_type, states, model


async def workflow_settings(client, issue_type):
    result = await client.call_tool(
        "get_issue_type_workflow_settings", {"type_id": str(issue_type.id)}
    )
    return result.data


@pytest.mark.django_db(transaction=True)
async def test_mcp_workflow_tools_apply_revision_guarded_changes_over_http(
    mcp_client,
    mcp_workflow,
):
    issue_type, states, model = mcp_workflow
    type_id = str(issue_type.id)
    ready_id = str(states["Ready"].id)
    build_id = str(states["Build"].id)
    done_id = str(states["Done"].id)

    initial = await workflow_settings(mcp_client, issue_type)
    assert initial["workflow_revision"] == 0
    assert initial["transitions"] == []

    await mcp_client.call_tool(
        "add_issue_type_workflow_transition",
        {
            "type_id": type_id,
            "from_state_id": ready_id,
            "to_state_id": build_id,
            "workflow_revision": 0,
            "agent_allowed": True,
        },
    )
    await mcp_client.call_tool(
        "add_issue_type_workflow_transition",
        {
            "type_id": type_id,
            "from_state_id": build_id,
            "to_state_id": done_id,
            "workflow_revision": 1,
            "agent_allowed": True,
        },
    )
    await mcp_client.call_tool(
        "set_issue_type_workflow_transition_permission",
        {
            "type_id": type_id,
            "from_state_id": ready_id,
            "to_state_id": build_id,
            "agent_allowed": False,
            "workflow_revision": 2,
        },
    )
    configured = await workflow_settings(mcp_client, issue_type)
    assert configured["workflow_revision"] == 3
    assert configured["transitions"] == [
        {
            "from_state_id": ready_id,
            "to_state_id": build_id,
            "agent_allowed": False,
        },
        {
            "from_state_id": build_id,
            "to_state_id": done_id,
            "agent_allowed": True,
        },
    ]

    await mcp_client.call_tool(
        "upsert_issue_type_workflow_launch_binding",
        {
            "type_id": type_id,
            "state_id": build_id,
            "workflow_revision": 3,
            "prompt": "Implement the work item.",
            "agent": "codex",
            "model": model.name,
        },
    )
    auto_started = await mcp_client.call_tool(
        "set_issue_type_workflow_auto_start",
        {
            "type_id": type_id,
            "state_id": build_id,
            "auto_start": True,
            "workflow_revision": 4,
        },
    )
    assert auto_started.data["auto_start"] is True
    automated = await workflow_settings(mcp_client, issue_type)
    assert automated["workflow_revision"] == 5
    assert automated["launch_bindings"] == [
        {
            "state_id": build_id,
            "prompt": "Implement the work item.",
            "required_skills": [],
            "entry_skill": None,
            "agent": "codex",
            "model": model.name,
            "reasoning": None,
            "auto_start": True,
            "subtree_run_enabled": False,
        }
    ]

    await mcp_client.call_tool(
        "clear_issue_type_workflow_launch_binding",
        {
            "type_id": type_id,
            "state_id": build_id,
            "workflow_revision": 5,
        },
    )
    await mcp_client.call_tool(
        "set_issue_type_workflow_start_state",
        {
            "type_id": type_id,
            "state_id": build_id,
            "workflow_revision": 6,
        },
    )
    await mcp_client.call_tool(
        "remove_issue_type_workflow_transition",
        {
            "type_id": type_id,
            "from_state_id": build_id,
            "to_state_id": done_id,
            "workflow_revision": 7,
        },
    )
    final = await workflow_settings(mcp_client, issue_type)
    assert final["workflow_revision"] == 8
    assert final["start_state_id"] == build_id
    assert final["transitions"] == []
    assert final["launch_bindings"] == []
