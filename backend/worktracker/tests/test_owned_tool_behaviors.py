"""S3 — the 13 MCP tool behaviors against the owned backend.

Each test exercises one frozen ``WorkTrackerToolset`` tool as the exact owned-route
call a retargeted ``WorkTrackerToolContext`` makes (Recipe A). Proven here in-repo so
the contract holds independent of the cross-repo meml edit. The three tools with
upstream resolution (7, 11, 12) get dedicated behavior assertions.
"""

from pathlib import Path
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from worktracker.models import IssueType
from worktracker.tests.conftest import BASE, patch_json, post_json


def _task_type(project):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    return issue_type


@pytest.fixture
def module(client, project, auth):
    """Create one module and return its JSON."""
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    return post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        {"name": "Epic", "issue_type_id": str(issue_type.id)},
        auth,
    ).json()


@pytest.fixture
def task(client, project, auth):
    """Create one project-scoped task and return its JSON."""
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )
    return post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "issue_type_id": str(issue_type.id)},
        auth,
    ).json()


@pytest.mark.django_db
def test_tool1_list_projects(client, project, auth):
    r = client.get(f"{BASE}/projects", headers=auth)
    assert r.status_code == 200
    assert any(p["id"] == str(project.id) for p in r.json())


@pytest.mark.django_db
def test_tool2_list_modules(client, project, module, auth):
    r = client.get(f"{BASE}/projects/{project.id}/modules", headers=auth)
    assert r.status_code == 200
    assert [m["id"] for m in r.json()] == [module["id"]]


@pytest.mark.django_db
def test_tool3_list_module_work_items(client, project, module, auth):
    post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        {"name": "C", "issue_type_id": str(_task_type(project).id)},
        auth,
    )
    r = client.get(f"{BASE}/modules/{module['id']}/work-items", headers=auth)
    assert r.status_code == 200
    assert [w["name"] for w in r.json()] == ["C"]


@pytest.mark.django_db
def test_tool4_list_states(client, project, state, auth):
    r = client.get(f"{BASE}/projects/{project.id}/states", headers=auth)
    assert r.status_code == 200
    assert any(s["name"] == "Todo" for s in r.json())


@pytest.mark.django_db
def test_tool5_list_tasks_with_state_filter(client, project, state, auth):
    post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {
            "name": "withstate",
            "state_id": str(state.id),
            "issue_type_id": str(_task_type(project).id),
        },
        auth,
    )
    post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "plain", "issue_type_id": str(_task_type(project).id)},
        auth,
    )

    allr = client.get(f"{BASE}/projects/{project.id}/work-items", headers=auth)
    assert len(allr.json()) == 2

    filtered = client.get(
        f"{BASE}/projects/{project.id}/work-items?state={state.id}", headers=auth
    )
    assert [w["name"] for w in filtered.json()] == ["withstate"]


@pytest.mark.django_db
def test_tool6_list_sub_tasks(client, project, task, auth):
    sub = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {
            "name": "sub",
            "parent_id": task["id"],
            "issue_type_id": task["issue_type"]["id"],
        },
        auth,
    ).json()

    r = client.get(
        f"{BASE}/projects/{project.id}/work-items?parent={task['id']}", headers=auth
    )
    assert [w["id"] for w in r.json()] == [sub["id"]]


@pytest.mark.django_db
def test_tool7_resolves_uuid_and_key(client, project, task, auth):
    by_uuid = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    by_key = client.get(f"{BASE}/work-items/{task['key']}", headers=auth)

    assert by_uuid.status_code == by_key.status_code == 200
    assert by_uuid.json()["task"]["id"] == by_key.json()["task"]["id"] == task["id"]


@pytest.mark.django_db
def test_tool8_create_work_item(client, project, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "new", "issue_type_id": str(_task_type(project).id)},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "new"


@pytest.mark.django_db
def test_tool8_create_work_item_missing_project(client, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{uuid.uuid4()}/work-items",
        {"name": "new", "issue_type_id": str(uuid.uuid4())},
        auth,
    )
    assert r.status_code == 404


@pytest.mark.django_db
def test_tool9_create_module_work_item(client, project, module, auth):
    r = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        {"name": "mwi", "issue_type_id": str(_task_type(project).id)},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["parent_id"] == module["id"]


@pytest.mark.django_db
def test_tool10_create_sub_task(client, project, task, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {
            "name": "child",
            "parent_id": task["id"],
            "issue_type_id": task["issue_type"]["id"],
        },
        auth,
    )
    assert r.status_code == 200
    assert r.json()["parent_id"] == task["id"]


@pytest.mark.django_db
def test_create_work_item_description_round_trips(client, project, module, auth):
    for path in (
        f"{BASE}/projects/{project.id}/work-items",
        f"{BASE}/modules/{module['id']}/work-items",
    ):
        created = post_json(
            client,
            path,
            {
                "name": "desc",
                "description": "## body",
                "issue_type_id": str(_task_type(project).id),
            },
            auth,
        )
        assert created.status_code == 200

        detail = client.get(f"{BASE}/work-items/{created.json()['id']}", headers=auth)
        assert detail.json()["task"]["description"] == "## body"


@pytest.mark.django_db
def test_tool11_resolves_status_name(client, project, state, task, auth):
    # The tool resolves a human status name to an id via the states list, then
    # patches. Replicate that two-step here.

    states = client.get(f"{BASE}/projects/{project.id}/states", headers=auth).json()
    state_id = next(s["id"] for s in states if s["name"] == "Todo")

    r = patch_json(client, f"{BASE}/work-items/{task['id']}", {"state_id": state_id}, auth)
    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Todo"


@pytest.mark.django_db
def test_tool12_append_is_read_modify_write(client, project, task, auth):
    # No append route — the tool does GET + concat + PATCH.

    current = client.get(f"{BASE}/work-items/{task['id']}", headers=auth).json()
    existing = current["task"]["description"] or ""

    merged = existing + "appended"
    r = patch_json(
        client, f"{BASE}/work-items/{task['id']}", {"description": merged}, auth
    )
    assert r.status_code == 200
    assert r.json()["description"] == "appended"


@pytest.mark.django_db
def test_tool13_attach_work_item_file(client, project, task, auth, tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)

    upload = SimpleUploadedFile("spec.txt", b"data", content_type="text/plain")
    r = client.post(
        f"{BASE}/work-items/{task['id']}/attachments",
        data={"file": upload},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["filename"] == "spec.txt"
    assert list(Path(tmp_path).rglob("spec*.txt"))
