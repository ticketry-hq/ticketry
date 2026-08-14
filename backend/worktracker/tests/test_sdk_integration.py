"""Owned SDK integration tests through the mounted Django HTTP API."""

from dataclasses import dataclass
from pathlib import Path
import uuid

import pytest

from worktracker_sdk.generated.api.attachments_api import AttachmentsApi
from worktracker_sdk.generated.api.modules_api import ModulesApi
from worktracker_sdk.generated.api.projects_api import ProjectsApi
from worktracker_sdk.generated.api.states_api import StatesApi
from worktracker_sdk.generated.api.work_items_api import WorkItemsApi
from worktracker_sdk.generated.api_client import ApiClient
from worktracker_sdk.generated.configuration import Configuration
from worktracker_sdk.generated.exceptions import UnauthorizedException
from worktracker_sdk.generated.models.module import Module
from worktracker_sdk.generated.models.module_create import ModuleCreate
from worktracker_sdk.generated.models.patched_work_item_patch import (
    PatchedWorkItemPatch,
)
from worktracker_sdk.generated.models.work_item import WorkItem
from worktracker_sdk.generated.models.work_item_create import WorkItemCreate
from worktracker.models import IssueTypeTransition, State
from worktracker.tests.conftest import TOKEN


def sdk(live_server, api_key=TOKEN):
    """Return a generated SDK client targeting the live mounted owned API."""
    return ApiClient(
        Configuration(
            host=f"{live_server.url}/api",
            api_key={"ApiKeyAuth": api_key},
        )
    )


@dataclass(frozen=True)
class GeneratedModuleTree:
    work_items: WorkItemsApi
    module: Module
    task: WorkItem
    child: WorkItem


@pytest.fixture
def generated_module_tree(live_server, project, module_type, task_type, state):
    """Create a module, task, and child through the generated SDK."""
    initial = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="SDK initial",
        group="unstarted",
    )
    task_type.start_state = initial
    task_type.save(update_fields=("start_state", "updated_at"))
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=initial,
        to_state=state,
    )
    with sdk(live_server) as client:
        modules = ModulesApi(client)
        work_items = WorkItemsApi(client)
        module = modules.create_module(
            project.id,
            ModuleCreate(name="SDK", issue_type_id=module_type.id),
        )
        task = work_items.create_work_item(
            project.id,
            WorkItemCreate(
                name="Implement",
                parent_id=module.id,
                issue_type_id=task_type.id,
            ),
        )
        child = work_items.create_work_item(
            project.id,
            WorkItemCreate(
                name="Test", parent_id=task.id, issue_type_id=task_type.id
            ),
        )
        yield GeneratedModuleTree(work_items, module, task, child)


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_lists_owned_resources(
    live_server, project, state, module_type
):
    with sdk(live_server) as client:
        projects = ProjectsApi(client)
        modules = ModulesApi(client)
        states = StatesApi(client)
        module = modules.create_module(
            project.id,
            ModuleCreate(name="SDK", issue_type_id=module_type.id),
        )

        assert {
            "projects": [item.id for item in projects.list_projects()],
            "modules": [item.id for item in modules.list_modules(project.id)],
            "states": [item.id for item in states.list_states(project.id)],
        } == {
            "projects": [project.id],
            "modules": [module.id],
            "states": [state.id],
        }


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_lists_module_descendants(generated_module_tree):
    assert {
        item.id
        for item in generated_module_tree.work_items.list_work_items(
            module=generated_module_tree.module.id
        )
    } == {
        generated_module_tree.task.id,
        generated_module_tree.child.id,
    }


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_retrieves_work_item_by_id_and_key(generated_module_tree):
    assert (
        generated_module_tree.work_items.get_work_item(
            str(generated_module_tree.task.id)
        ).id,
        generated_module_tree.work_items.get_work_item(
            generated_module_tree.task.key
        ).id,
    ) == (generated_module_tree.task.id, generated_module_tree.task.id)


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_updates_work_item_state(generated_module_tree, state):
    updated = generated_module_tree.work_items.update_work_item(
        str(generated_module_tree.task.id),
        PatchedWorkItemPatch(state_id=state.id),
    )

    assert updated.state == state.id


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_updates_work_item_description(generated_module_tree):
    updated = generated_module_tree.work_items.update_work_item(
        str(generated_module_tree.task.id),
        PatchedWorkItemPatch(description="## SDK note"),
    )

    assert updated.description == "## SDK note"


@pytest.mark.django_db(transaction=True)
def test_sdk_multipart_upload_and_detail_read(
    live_server, project, task_type, tmp_path, settings
):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    source = tmp_path / "notes.txt"
    source.write_text("hello")

    with sdk(live_server) as client:
        work_items = WorkItemsApi(client)
        attachments = AttachmentsApi(client)
        task = work_items.create_work_item(
            project.id,
            WorkItemCreate(name="Upload", issue_type_id=task_type.id),
        )
        attachment = attachments.upload_attachment(
            str(task.id),
            str(source),
            name="Review notes",
        )
        detail = work_items.get_work_item(str(task.id))
        listed = attachments.list_work_item_attachments(str(task.id))

    assert attachment.filename == "Review notes"
    assert detail.id == task.id
    assert listed[0].id == attachment.id
    assert list(Path(settings.MEDIA_ROOT).rglob("notes*.txt"))


@pytest.mark.django_db(transaction=True)
def test_sdk_rejected_api_key(live_server, project, settings):
    settings.WORKTRACKER_DISABLE_AUTH = False
    with sdk(live_server, api_key="wrong") as client:
        with pytest.raises(UnauthorizedException):
            ProjectsApi(client).list_projects()
