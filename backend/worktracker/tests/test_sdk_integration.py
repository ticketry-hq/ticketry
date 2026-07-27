"""Owned SDK integration tests through the mounted Django HTTP API."""

from dataclasses import dataclass
from pathlib import Path

import pytest

from worktracker_sdk.generated.api.attachments_api import AttachmentsApi
from worktracker_sdk.generated.api.modules_api import ModulesApi
from worktracker_sdk.generated.api.projects_api import ProjectsApi
from worktracker_sdk.generated.api.states_api import StatesApi
from worktracker_sdk.generated.api.work_items_api import WorkItemsApi
from worktracker_sdk.generated.api_client import ApiClient
from worktracker_sdk.generated.configuration import Configuration
from worktracker_sdk.generated.exceptions import UnauthorizedException
from worktracker_sdk.generated.models.module_in import ModuleIn
from worktracker_sdk.generated.models.module_out import ModuleOut
from worktracker_sdk.generated.models.module_work_item_in import ModuleWorkItemIn
from worktracker_sdk.generated.models.work_item_in import WorkItemIn
from worktracker_sdk.generated.models.work_item_out import WorkItemOut
from worktracker_sdk.generated.models.work_item_patch import WorkItemPatch
from worktracker.tests.conftest import BASE, TOKEN


def sdk(live_server, api_key=TOKEN):
    """Return a generated SDK client targeting the live mounted owned API."""
    return ApiClient(
        Configuration(
            host=f"{live_server.url}{BASE}",
            api_key={"ApiKeyAuth": api_key},
        )
    )


@dataclass(frozen=True)
class GeneratedModuleTree:
    work_items: WorkItemsApi
    module: ModuleOut
    task: WorkItemOut
    child: WorkItemOut


@pytest.fixture
def generated_module_tree(live_server, project):
    """Create a module, task, and child through the generated SDK."""
    with sdk(live_server) as client:
        modules = ModulesApi(client)
        work_items = WorkItemsApi(client)
        module = modules.create_module(project.id, ModuleIn(name="SDK"))
        task = work_items.create_module_work_item(
            module.id,
            ModuleWorkItemIn(name="Implement"),
        )
        child = work_items.create_project_work_item(
            project.id,
            WorkItemIn(name="Test", parent_id=task.id),
        )
        yield GeneratedModuleTree(work_items, module, task, child)


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_lists_owned_resources(live_server, project, state):
    with sdk(live_server) as client:
        projects = ProjectsApi(client)
        modules = ModulesApi(client)
        states = StatesApi(client)
        module = modules.create_module(project.id, ModuleIn(name="SDK"))

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
        for item in generated_module_tree.work_items.list_module_work_items(
            generated_module_tree.module.id
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
        ).task.id,
        generated_module_tree.work_items.get_work_item(
            generated_module_tree.task.key
        ).task.id,
    ) == (generated_module_tree.task.id, generated_module_tree.task.id)


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_updates_work_item_state(generated_module_tree, state):
    updated = generated_module_tree.work_items.update_work_item(
        str(generated_module_tree.task.id),
        WorkItemPatch(state_id=state.id),
    )

    assert updated.state.id == state.id


@pytest.mark.django_db(transaction=True)
def test_generated_sdk_updates_work_item_description(generated_module_tree):
    updated = generated_module_tree.work_items.update_work_item(
        str(generated_module_tree.task.id),
        WorkItemPatch(description_html="<p>SDK note</p>"),
    )

    assert updated.description_html == "<p>SDK note</p>"


@pytest.mark.django_db(transaction=True)
def test_sdk_multipart_upload_and_detail_read(live_server, project, tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    source = tmp_path / "notes.txt"
    source.write_text("hello")

    with sdk(live_server) as client:
        work_items = WorkItemsApi(client)
        attachments = AttachmentsApi(client)
        task = work_items.create_project_work_item(
            project.id,
            WorkItemIn(name="Upload"),
        )
        attachment = attachments.upload_attachment(
            task.id,
            str(source),
            name="Review notes",
        )
        detail = work_items.get_work_item(str(task.id))

    assert attachment.filename == "Review notes"
    assert detail.attachments[0].id == attachment.id
    assert list(Path(settings.MEDIA_ROOT).rglob("notes*.txt"))


@pytest.mark.django_db(transaction=True)
def test_sdk_rejected_api_key(live_server, project, settings):
    settings.WORKTRACKER_DISABLE_AUTH = False
    with sdk(live_server, api_key="wrong") as client:
        with pytest.raises(UnauthorizedException):
            ProjectsApi(client).list_projects()
