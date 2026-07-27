"""The MCP work-item surface aligned to the unified Issue/IssueType model (CODIN-890).

Modules and tasks are one ``Issue`` table discriminated by ``issue_type.level``;
issue types are first-class rows served by ``GET /projects/{id}/issue-types``.
These tests pin the MCP layer to that model: modules deserialize as issues (key /
sequence / nested type), tasks carry their ``issue_type`` + ``parent_id``, and the
new ``list_issue_types`` read surface — the home CODIN-883 resolves a name
against — is present and typed.
"""

import inspect
from uuid import UUID

import pytest

from worktracker_sdk.generated import ModuleWorkItemIn, WorkItemIn, WorkItemPatch
from worktracker_sdk.generated.exceptions import ApiException, NotFoundException

from fake_sdk import (
    FakeGeneratedSdk,
    make_api_error,
    make_detail,
    make_issue_type,
    make_module,
    make_state,
    make_work_item,
    raises,
)
from worktracker_agent.api.service import WorktrackerService
from worktracker_agent.mcp.tools_adapter import generate_worktracker_tools


PROJECT = "22222222-2222-2222-2222-222222222222"
MODULE = "33333333-3333-3333-3333-333333333333"
TASK = "44444444-4444-4444-4444-444444444444"
EPIC_TYPE = "55555555-5555-5555-5555-555555555555"
STORY_TYPE = "66666666-6666-6666-6666-666666666666"


def _service():
    return WorktrackerService(base_url="http://example.test")


# --- update_task: metadata-only replacement ---------------------------------


def test_update_task_replaces_title_by_uuid_with_metadata_only_payload():
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK,
        key="CODIN-1068",
        name="Sharper title",
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task(TASK, name="Sharper title")

    assert result == {
        "ok": True,
        "task_id": TASK,
        "key": "CODIN-1068",
        "updated_fields": ["name"],
    }
    assert len(client.work_items.calls) == 1
    method, args, kwargs = client.work_items.calls[0]
    assert method == "update_work_item" and args[0] == TASK and kwargs == {}
    assert isinstance(args[1], WorkItemPatch)
    assert args[1].model_dump(mode="json", exclude_unset=True) == {
        "name": "Sharper title",
    }


def test_update_task_replaces_description_by_key_without_append_behavior():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_detail(
        make_work_item(id=TASK, key="CODIN-1068")
    )
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK,
        key="CODIN-1068",
        description_html="<p>Replacement</p>",
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task("CODIN-1068", description="<p>Replacement</p>")

    assert result == {
        "ok": True,
        "task_id": TASK,
        "key": "CODIN-1068",
        "updated_fields": ["description"],
    }
    assert client.work_items.calls[0] == ("get_work_item", ("CODIN-1068",), {})
    method, args, kwargs = client.work_items.calls[1]
    assert method == "update_work_item" and args[0] == TASK and kwargs == {}
    assert isinstance(args[1], WorkItemPatch)
    assert args[1].model_dump(mode="json", exclude_unset=True) == {
        "description_html": "<p>Replacement</p>",
    }
    assert all(
        method != "append_description"
        for method, _args, _kwargs in client.work_items.calls
    )


def test_append_task_description_reads_then_patches_with_generated_models():
    client = FakeGeneratedSdk()
    client.work_items.returns["get_work_item"] = make_detail(
        make_work_item(id=TASK, description_html="<p>Existing</p>")
    )
    client.work_items.returns["update_work_item"] = make_work_item(id=TASK)
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.append_task_description(PROJECT, TASK, "<p>Added</p>")

    assert result is True
    assert [call[0] for call in client.work_items.calls] == [
        "get_work_item",
        "update_work_item",
    ]
    patch = client.work_items.calls[1][1][1]
    assert isinstance(patch, WorkItemPatch)
    assert patch.description_html == "<p>Existing</p>\n\n<p>Added</p>"


def test_update_task_replaces_title_and_description_in_one_typed_update():
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK,
        key="CODIN-1068",
        name="Sharper title",
        description_html="<p>Replacement</p>",
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task(
        TASK,
        name="Sharper title",
        description="<p>Replacement</p>",
    )

    assert result["updated_fields"] == ["name", "description"]
    assert len(client.work_items.calls) == 1
    method, args, _kwargs = client.work_items.calls[0]
    assert method == "update_work_item"
    assert isinstance(args[1], WorkItemPatch)
    assert args[1].model_dump(mode="json", exclude_unset=True) == {
        "name": "Sharper title",
        "description_html": "<p>Replacement</p>",
    }


def test_update_task_explicit_empty_description_clears_it():
    client = FakeGeneratedSdk()
    client.work_items.returns["update_work_item"] = make_work_item(
        id=TASK,
        key="CODIN-1068",
        description_html="",
    )
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.update_task(TASK, description="")

    assert result["updated_fields"] == ["description"]
    _method, args, _kwargs = client.work_items.calls[0]
    assert args[1].model_dump(mode="json", exclude_unset=True) == {
        "description_html": "",
    }


def test_update_task_rejects_empty_title_before_sdk_access():
    client = FakeGeneratedSdk()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ValueError, match="name must not be empty"):
        service.update_task(TASK, name="")

    assert client.work_items.calls == []


def test_update_task_rejects_call_with_no_supplied_fields():
    client = FakeGeneratedSdk()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ValueError, match="name or description is required"):
        service.update_task(TASK)

    assert client.work_items.calls == []


def test_update_task_propagates_sdk_failures():
    client = FakeGeneratedSdk()
    error = make_api_error(500, {"detail": "boom"})
    client.work_items.returns["update_work_item"] = raises(error)
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(ApiException) as caught:
        service.update_task(TASK, name="Sharper title")

    assert caught.value is error


def test_update_task_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "update_task" in tool_names


def test_update_task_tool_signature_is_public_and_context_free():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["update_task"]).parameters) == (
        "id_or_key",
        "name",
        "description",
    )


# --- list_issue_types: the name→type home for CODIN-883 ----------------------


def test_list_issue_types_reads_typed_rows_off_the_sdk():
    client = FakeGeneratedSdk()
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=EPIC_TYPE, name="Epic", level="module", is_default=True),
        make_issue_type(id=STORY_TYPE, name="Story", level="task", is_default=False),
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    types = service.list_issue_types(PROJECT)

    # Resolved project UUID reaches the SDK issue-types listing.
    assert client.issue_types.calls[0][1] == (UUID(PROJECT),)
    assert [t.name for t in types] == ["Epic", "Story"]
    assert [t.level for t in types] == ["module", "task"]
    assert types[0].is_default is True


# --- modules are issues of level module --------------------------------------


def test_list_modules_deserializes_unified_issue_shape():
    client = FakeGeneratedSdk()
    client.modules.returns["list_modules"] = [
        make_module(
            id=MODULE,
            name="Payments",
            project_id=PROJECT,
            sequence_id=7,
            key="MEML-7",
            is_archived=False,
            issue_type=make_issue_type(
                id=EPIC_TYPE,
                name="Epic",
                level="module",
                color="#111",
            ),
        )
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    modules = service.list_modules(PROJECT)

    assert len(modules) == 1
    module = modules[0]
    assert module.key == "MEML-7"
    assert module.sequence_id == 7
    # A module carries its named type, and that type's level pins it to the
    # module bucket — the discriminator, not a separate "module kind".
    assert module.issue_type is not None
    assert module.issue_type.level == "module"
    assert module.issue_type.name == "Epic"


# --- tasks carry issue_type + parent linkage ---------------------------------


def test_task_shape_surfaces_issue_type_and_parent():
    client = FakeGeneratedSdk()
    client.work_items.returns["list_project_work_items"] = [
        make_work_item(
            id=TASK,
            name="Wire the gate",
            project_id=PROJECT,
            sequence_id=12,
            key="MEML-12",
            parent_id=MODULE,
            issue_type=make_issue_type(id=STORY_TYPE, name="Story", level="task"),
            is_archived=False,
        )
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    tasks = service.list_tasks(PROJECT)

    assert len(tasks) == 1
    task = tasks[0]
    assert str(task.parent_id) == MODULE
    assert task.issue_type is not None
    assert task.issue_type.name == "Story"
    assert task.issue_type.level == "task"


def test_task_shape_tolerates_absent_issue_type():
    """Pre-migration issues serialize ``issue_type`` as null; the shape holds."""
    client = FakeGeneratedSdk()
    client.work_items.returns["list_project_work_items"] = [
        make_work_item(
            id=TASK,
            name="Legacy row",
            project_id=PROJECT,
            sequence_id=1,
            key="MEML-1",
            issue_type=None,
        )
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    task = service.list_tasks(PROJECT)[0]

    assert task.issue_type is None
    assert task.parent_id is None


# --- reparent: SDK accounting mapped onto the tool result --------------------


def test_reparent_tasks_maps_sdk_accounting():
    client = FakeGeneratedSdk()

    def get_work_item(id_or_key):
        if id_or_key == MODULE:
            return make_detail(make_work_item(id=MODULE, project_id=PROJECT))
        if id_or_key == TASK:
            return make_detail(make_work_item(id=TASK, project_id=PROJECT))
        raise NotFoundException(status=404)

    client.work_items.returns["get_work_item"] = get_work_item
    client.work_items.returns["update_work_item"] = make_work_item(id=TASK)
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    result = service.reparent_tasks(PROJECT, MODULE, [TASK, "CODIN-9"])

    update = next(c for c in client.work_items.calls if c[0] == "update_work_item")
    assert update[1][0] == TASK
    assert isinstance(update[1][1], WorkItemPatch)
    assert update[1][1].parent_id == UUID(MODULE)
    assert result == {
        "parent_task_id": MODULE,
        "reparented": [{"task_id": TASK, "previous_parent_id": None}],
        "skipped": [{"task_id": "CODIN-9", "reason": "not_found"}],
        "failed": [],
    }


# --- registration ------------------------------------------------------------


def test_list_issue_types_tool_is_registered():
    tool_names = {name for name, _tool in generate_worktracker_tools()}

    assert "list_issue_types" in tool_names


def test_list_issue_types_tool_signature_is_public():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["list_issue_types"]).parameters) == (
        "project_id",
    )


def test_create_tools_public_signature_omits_priority_and_accepts_type_and_state():
    tools = dict(generate_worktracker_tools())

    assert tuple(inspect.signature(tools["create_task"]).parameters) == (
        "project_id",
        "name",
        "description",
        "module_id",
        "issue_type",
        "state_name",
    )
    assert tuple(inspect.signature(tools["create_sub_task"]).parameters) == (
        "project_id",
        "parent_id",
        "name",
        "description",
        "issue_type",
        "state_name",
    )

    with pytest.raises(TypeError):
        tools["create_task"]("ctx", PROJECT, "Stale", priority="high")
    with pytest.raises(TypeError):
        tools["create_sub_task"]("ctx", PROJECT, TASK, "Stale", priority="high")


def test_create_task_resolves_implementation_type_and_ready_state_into_sdk_payload():
    client = FakeGeneratedSdk()
    implementation_type = "77777777-7777-7777-7777-777777777777"
    ready_state = "88888888-8888-8888-8888-888888888888"
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=EPIC_TYPE, name="Epic", level="module"),
        make_issue_type(id=implementation_type, name="Implementation", level="task"),
    ]
    client.states.returns["list_states"] = [make_state(id=ready_state, name="Ready")]
    client.work_items.returns["create_project_work_item"] = make_work_item()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    service.create_task(
        PROJECT,
        "Build it",
        issue_type="implementation",
        state_name="ready",
    )

    assert client.issue_types.calls == [("list_issue_types", (UUID(PROJECT),), {})]
    name, args, kwargs = client.work_items.calls[0]
    assert (
        name == "create_project_work_item" and args[0] == UUID(PROJECT) and kwargs == {}
    )
    assert isinstance(args[1], WorkItemIn)
    assert args[1].model_dump(mode="json", exclude_none=True) == {
        "name": "Build it",
        "description": "",
        "issue_type_id": implementation_type,
        "state_id": ready_state,
    }


def test_create_sub_task_resolves_canonical_birth_state_into_sdk_payload():
    client = FakeGeneratedSdk()
    pathfind_type = "77777777-7777-7777-7777-777777777777"
    refinement_state = "88888888-8888-8888-8888-888888888888"
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=pathfind_type, name="PathFind", level="task"),
    ]
    client.states.returns["list_states"] = [
        make_state(id=refinement_state, name="Refinement"),
    ]
    client.work_items.returns["create_project_work_item"] = make_work_item()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    service.create_sub_task(
        PROJECT,
        TASK,
        "Discover API constraints",
        issue_type="pathfind",
        state_name="refinement",
    )

    name, args, kwargs = client.work_items.calls[0]
    assert (
        name == "create_project_work_item" and args[0] == UUID(PROJECT) and kwargs == {}
    )
    assert isinstance(args[1], WorkItemIn)
    assert args[1].model_dump(mode="json", exclude_none=True) == {
        "name": "Discover API constraints",
        "description": "",
        "parent_id": TASK,
        "issue_type_id": pathfind_type,
        "state_id": refinement_state,
    }


def test_module_task_and_sub_task_include_resolved_issue_type_id():
    client = FakeGeneratedSdk()
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=STORY_TYPE, name="Story", level="task"),
    ]
    client.work_items.returns["create_module_work_item"] = make_work_item()
    client.work_items.returns["create_project_work_item"] = make_work_item()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    service.create_task(PROJECT, "Module child", module_id=MODULE, issue_type="Story")
    service.create_sub_task(PROJECT, TASK, "Nested", issue_type="Story")

    _name, module_args, _kwargs = client.work_items.calls[0]
    assert isinstance(module_args[1], ModuleWorkItemIn)
    assert module_args[1].issue_type_id == UUID(STORY_TYPE)
    _name, subtask_args, _kwargs = client.work_items.calls[1]
    assert subtask_args[1].parent_id == UUID(TASK)
    assert subtask_args[1].issue_type_id == UUID(STORY_TYPE)


def test_create_without_issue_type_uses_default_without_lookup_or_payload_field():
    client = FakeGeneratedSdk()
    client.work_items.returns["create_project_work_item"] = make_work_item()
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    service.create_task(PROJECT, "Default type")

    assert client.issue_types.calls == []
    _name, args, _kwargs = client.work_items.calls[0]
    assert "issue_type_id" not in args[1].model_dump(mode="json", exclude_none=True)


def test_create_rejects_unknown_or_non_task_issue_type_with_valid_task_names():
    client = FakeGeneratedSdk()
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=EPIC_TYPE, name="Epic", level="module"),
        make_issue_type(id=STORY_TYPE, name="Story", level="task"),
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(
        ValueError,
        match=r"Unknown task issue type 'Epic'. Valid task-level types: Story\.",
    ):
        service.create_task(PROJECT, "Wrong type", issue_type="Epic")


def test_create_rejects_uuid_even_when_a_type_name_matches_it():
    client = FakeGeneratedSdk()
    client.issue_types.returns["list_issue_types"] = [
        make_issue_type(id=STORY_TYPE, name=STORY_TYPE, level="task"),
    ]
    service = WorktrackerService(base_url="http://example.test", sdk=client)

    with pytest.raises(
        ValueError,
        match=rf"Unknown task issue type '{STORY_TYPE}'. Valid task-level types: {STORY_TYPE}\.",
    ):
        service.create_task(PROJECT, "Raw id", issue_type=STORY_TYPE)
