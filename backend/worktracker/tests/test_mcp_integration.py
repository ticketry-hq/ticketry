"""End-to-end tests for the WorkTracker MCP HTTP service."""

import uuid

import pytest

from worktracker.models import Issue, IssueTypeTransition, State
from worktracker.sequences import allocate_sequence_id


@pytest.fixture
def mcp_work_items(project, state, task_type, module_type):
    task_type.start_state = state
    task_type.save(update_fields=("start_state", "updated_at"))
    done = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Done",
        group="completed",
        sort_order=1,
    )
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=state,
        to_state=done,
        agent_allowed=True,
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Integration module",
        sequence_id=allocate_sequence_id(project.id),
    )
    return {"module": module, "done": done}


@pytest.mark.django_db(transaction=True)
async def test_mcp_http_client_discovers_tools_and_reads_installation_project(
    mcp_client,
    project,
):
    tools = await mcp_client.list_tools()

    assert {tool.name for tool in tools} == {
        "add_issue_type_workflow_transition",
        "add_task_blocker",
        "add_task_dependent",
        "append_task_description",
        "attach_file",
        "clear_issue_type_workflow_launch_binding",
        "create_review_finding",
        "create_sub_task",
        "create_task",
        "execute_dependency_graph",
        "get_dependency_graph",
        "get_issue_type_workflow_settings",
        "get_task_details",
        "get_task_scope_context",
        "launch_default_coding_agent",
        "list_issue_types",
        "list_modules",
        "list_projects",
        "list_tasks",
        "mcp_ping",
        "remove_issue_type_workflow_transition",
        "reparent_tasks",
        "run_now",
        "set_issue_type_workflow_auto_start",
        "set_issue_type_workflow_start_state",
        "set_issue_type_workflow_transition_permission",
        "set_task_blockers",
        "terminate_current_run",
        "update_task",
        "update_task_status",
        "upsert_issue_type_workflow_launch_binding",
    }

    ping = await mcp_client.call_tool("mcp_ping", {})
    projects = await mcp_client.call_tool("list_projects", {})

    assert ping.data == {"status": "ok", "server": "worktracker-agent"}
    assert projects.data == [
        {
            "id": str(project.id),
            "name": "meml",
            "identifier": "MEML",
            "description": None,
        }
    ]


@pytest.mark.django_db(transaction=True)
async def test_mcp_work_item_tools_persist_and_read_back_over_http(
    mcp_client,
    project,
    task_type,
    module_type,
    mcp_work_items,
    tmp_path,
):
    project_id = str(project.id)
    module_id = str(mcp_work_items["module"].id)

    issue_types = await mcp_client.call_tool(
        "list_issue_types", {"project_id": project_id}
    )
    modules = await mcp_client.call_tool("list_modules", {"project_id": project_id})
    assert {item["name"] for item in issue_types.data} == {
        task_type.name,
        module_type.name,
    }
    assert [item["id"] for item in modules.data] == [module_id]

    created = await mcp_client.call_tool(
        "create_task",
        {
            "project_id": project_id,
            "name": "Parent task",
            "issue_type": task_type.name,
            "description": "Initial description",
            "module_id": module_id,
        },
    )
    parent_id = created.data
    child = await mcp_client.call_tool(
        "create_sub_task",
        {
            "project_id": project_id,
            "parent_id": parent_id,
            "name": "Child task",
            "issue_type": task_type.name,
        },
    )
    child_id = child.data
    blocker = await mcp_client.call_tool(
        "create_task",
        {
            "project_id": project_id,
            "name": "Blocker",
            "issue_type": task_type.name,
            "module_id": module_id,
        },
    )
    blocker_id = blocker.data

    await mcp_client.call_tool(
        "update_task",
        {
            "id_or_key": parent_id,
            "name": "Renamed parent",
            "description": "Replaced description",
        },
    )
    await mcp_client.call_tool(
        "append_task_description",
        {
            "project_id": project_id,
            "task_id": parent_id,
            "new_content": "Appended note",
        },
    )
    details = await mcp_client.call_tool("get_task_details", {"id_or_key": parent_id})
    assert details.data["name"] == "Renamed parent"
    assert details.data["description"] == "Replaced description\n\nAppended note"
    assert [item["id"] for item in details.data["sub_tasks"]] == [child_id]

    await mcp_client.call_tool(
        "set_task_blockers",
        {"task_id": child_id, "blocked_by_ids": [blocker_id]},
    )
    await mcp_client.call_tool(
        "add_task_blocker",
        {"task_id": parent_id, "blocker_task_id": blocker_id},
    )
    await mcp_client.call_tool(
        "add_task_dependent",
        {"task_id": parent_id, "dependent_task_id": child_id},
    )
    scope = await mcp_client.call_tool(
        "get_task_scope_context", {"id_or_key": child_id}
    )
    assert {item["id"] for item in scope.data["depends_on"]} == {
        blocker_id,
        parent_id,
    }

    new_parent = await mcp_client.call_tool(
        "create_task",
        {
            "project_id": project_id,
            "name": "New parent",
            "issue_type": task_type.name,
            "module_id": module_id,
        },
    )
    await mcp_client.call_tool(
        "reparent_tasks",
        {
            "project_id": project_id,
            "parent_task_id": new_parent.data,
            "task_ids": [child_id],
            "module_id": module_id,
        },
    )
    new_parent_details = await mcp_client.call_tool(
        "get_task_details", {"id_or_key": new_parent.data}
    )
    assert [item["id"] for item in new_parent_details.data["sub_tasks"]] == [child_id]

    attachment = tmp_path / "mcp-note.txt"
    attachment.write_text("MCP integration attachment")
    attached = await mcp_client.call_tool(
        "attach_file",
        {
            "project_id": project_id,
            "task_id": parent_id,
            "file_path": str(attachment),
        },
    )
    assert attached.structured_content["success"] is True
    details = await mcp_client.call_tool("get_task_details", {"id_or_key": parent_id})
    assert [item["name"] for item in details.data["attachments"]] == ["mcp-note.txt"]

    moved = await mcp_client.call_tool(
        "update_task_status",
        {
            "project_id": project_id,
            "task_id": parent_id,
            "status_name": "Done",
        },
    )
    assert moved.data["ok"] is True
    listed = await mcp_client.call_tool(
        "list_tasks",
        {
            "project_id": project_id,
            "module_id": module_id,
            "state_name": "Done",
            "include_description": True,
        },
    )
    assert [(item["id"], item["description"]) for item in listed.data] == [
        (parent_id, "Replaced description\n\nAppended note")
    ]
