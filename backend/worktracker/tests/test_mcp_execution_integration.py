"""MCP integration coverage for review and safe execution paths."""

import uuid

import pytest

from worktracker.models import DEFAULT_STATES, Issue, IssueType, State
from worktracker.sequences import allocate_sequence_id


@pytest.fixture
def mcp_review_story(project):
    states = {
        name: State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            sort_order=sort_order,
        )
        for sort_order, (name, group, _color) in enumerate(DEFAULT_STATES)
    }
    story_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
        start_state=states["Grill"],
    )
    IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        start_state=states["Implement"],
    )
    story = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=story_type,
        state=states["Review"],
        name="Story under review",
        sequence_id=allocate_sequence_id(project.id),
    )
    return story


@pytest.mark.django_db(transaction=True)
async def test_mcp_review_and_execution_tools_return_durable_or_safe_results(
    mcp_client,
    project,
    mcp_review_story,
):
    story_id = str(mcp_review_story.id)
    finding = await mcp_client.call_tool(
        "create_review_finding",
        {
            "project_id": str(project.id),
            "parent_id": story_id,
            "name": "Null dereference",
            "path": "backend/loader.py",
            "line_start": 10,
            "line_end": 12,
            "note": "Guard the optional value.",
        },
    )
    assert finding.data["ok"] is True
    finding_id = finding.data["task_id"]

    details = await mcp_client.call_tool("get_task_details", {"id_or_key": finding_id})
    assert details.data["parent_id"] == story_id
    assert details.data["description"] == (
        "Path: backend/loader.py\nLines: 10-12\nNote: Guard the optional value."
    )

    graph = await mcp_client.call_tool(
        "get_dependency_graph", {"root_task_id": story_id}
    )
    assert [(node["id"], node["state"]) for node in graph.data["nodes"]] == [
        (story_id, "Review"),
        (finding_id, "Implement"),
    ]

    empty_graph = await mcp_client.call_tool(
        "execute_dependency_graph", {"root_task_id": finding_id}
    )
    assert empty_graph.data == {
        "root_id": finding_id,
        "error": "subtree_run_not_enabled",
    }

    launch = await mcp_client.call_tool(
        "launch_default_coding_agent", {"id_or_key": story_id}
    )
    assert launch.data == {"target_id": story_id, "error": "module_id_required"}

    run_now = await mcp_client.call_tool("run_now", {"id_or_key": story_id})
    assert run_now.data["target_id"] == story_id
    assert run_now.data["code"] == "run_now_not_eligible"
    assert run_now.data["committed_state"] is None
    assert run_now.data["run"] is None

    termination = await mcp_client.call_tool("terminate_current_run", {})
    assert termination.data == {
        "ok": False,
        "error": "caller_run_unbound",
        "reason": "authorization_missing",
    }
