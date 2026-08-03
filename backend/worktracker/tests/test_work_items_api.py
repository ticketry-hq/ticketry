"""C2 — CRUD over the mounted router."""

import uuid

import pytest

from worktracker.models import Issue, IssueTypeTransition, State
from worktracker.tests.conftest import BASE, patch_json, post_json


def _task_body(task_type, **body):
    return {**body, "issue_type_id": str(task_type.id)}


def _module_body(module_type, **body):
    return {**body, "issue_type_id": str(module_type.id)}


@pytest.fixture
def module(client, project, module_type, auth):
    """Create one module and return its JSON."""
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        _module_body(module_type, name="Epic"),
        auth,
    )
    assert r.status_code == 200
    return r.json()


@pytest.mark.django_db
def test_create_module(client, project, module_type, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        _module_body(module_type, name="Epic"),
        auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Epic"
    assert body["key"] == "MEML-1"


@pytest.mark.django_db
def test_create_task_and_retrieve_by_uuid(client, project, task_type, auth):
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Task"),
        auth,
    ).json()

    r = client.get(f"{BASE}/work-items/{created['id']}", headers=auth)
    assert r.status_code == 200
    assert r.json()["task"]["id"] == created["id"]
    assert "priority" not in created
    assert "priority" not in r.json()["task"]


@pytest.mark.django_db
def test_retrieve_by_key(client, project, task_type, auth):
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Task"),
        auth,
    ).json()

    r = client.get(f"{BASE}/work-items/{created['key']}", headers=auth)
    assert r.status_code == 200
    assert r.json()["task"]["id"] == created["id"]


@pytest.mark.django_db
def test_list_by_project(client, project, task_type, auth):
    post_json(client, f"{BASE}/projects/{project.id}/work-items", _task_body(task_type, name="A"), auth)
    post_json(client, f"{BASE}/projects/{project.id}/work-items", _task_body(task_type, name="B"), auth)

    r = client.get(f"{BASE}/projects/{project.id}/work-items", headers=auth)
    assert r.status_code == 200
    assert len(r.json()) == 2
    assert all("priority" not in item for item in r.json())


@pytest.mark.django_db
def test_list_by_module_returns_subtree(client, project, module, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        _task_body(task_type, name="T"),
        auth,
    ).json()
    post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Sub", parent_id=task["id"]),
        auth,
    )

    r = client.get(f"{BASE}/modules/{module['id']}/work-items", headers=auth)
    assert r.status_code == 200
    body = r.json()
    # The whole task-descendant subtree: direct child + its subtask.
    assert len(body) == 2
    assert {item["parent_id"] for item in body} == {module["id"], task["id"]}
    assert all("priority" not in item for item in body)


def _assert_retired_priority_error(response, location):
    assert response.status_code == 422
    body = response.json()
    assert "priority" in str(body)
    assert location in str(body)


@pytest.mark.django_db
def test_project_create_rejects_retired_priority_without_writing(client, project, task_type, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Stale", priority="high"),
        auth,
    )

    _assert_retired_priority_error(r, "body")
    assert not Issue.objects.filter(project=project, name="Stale").exists()


@pytest.mark.django_db
def test_module_create_rejects_retired_priority_without_writing(
    client, project, module, task_type, auth
):
    r = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        _task_body(task_type, name="Stale", priority="high"),
        auth,
    )

    _assert_retired_priority_error(r, "body")
    assert not Issue.objects.filter(project=project, name="Stale").exists()


@pytest.mark.django_db
def test_patch_rejects_retired_priority_without_mutating(client, project, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Before"),
        auth,
    ).json()

    r = patch_json(
        client,
        f"{BASE}/work-items/{task['id']}",
        {"name": "After", "priority": "high"},
        auth,
    )

    _assert_retired_priority_error(r, "body")
    assert Issue.objects.get(pk=task["id"]).name == "Before"


@pytest.mark.django_db
@pytest.mark.parametrize("scope", ["project", "module"])
def test_list_rejects_retired_priority_query(client, project, module, auth, scope):
    if scope == "project":
        url = f"{BASE}/projects/{project.id}/work-items?priority=high"
    else:
        url = f"{BASE}/modules/{module['id']}/work-items?priority=high"

    _assert_retired_priority_error(client.get(url, headers=auth), "query")


@pytest.mark.django_db
def test_unrelated_unknown_create_field_keeps_existing_ignore_behavior(
    client, project, task_type, auth
):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Compatible", unknown_field="ignored"),
        auth,
    )

    assert r.status_code == 200
    assert r.json()["name"] == "Compatible"
    assert "priority" not in r.json()


@pytest.mark.django_db
def test_list_by_parent(client, project, module, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        _task_body(task_type, name="T"),
        auth,
    ).json()

    r = client.get(
        f"{BASE}/projects/{project.id}/work-items?parent={module['id']}", headers=auth
    )
    assert r.status_code == 200
    body = r.json()
    assert [item["id"] for item in body] == [task["id"]]


@pytest.mark.django_db
def test_patch_state(client, project, state, task_type, auth):
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog"
    )
    task_type.start_state = backlog
    task_type.save(update_fields=["start_state"])
    IssueTypeTransition.objects.create(
        issue_type=task_type, from_state=backlog, to_state=state
    )
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="T"),
        auth,
    ).json()

    r = patch_json(
        client, f"{BASE}/work-items/{task['id']}", {"state_id": str(state.id)}, auth
    )
    assert r.status_code == 200
    assert r.json()["state"]["id"] == str(state.id)


@pytest.mark.django_db
def test_patch_parent_reparents(client, project, module_type, task_type, auth):
    m1 = post_json(client, f"{BASE}/projects/{project.id}/modules", _module_body(module_type, name="M1"), auth).json()
    m2 = post_json(client, f"{BASE}/projects/{project.id}/modules", _module_body(module_type, name="M2"), auth).json()
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="T", parent_id=m1["id"]),
        auth,
    ).json()

    r = patch_json(client, f"{BASE}/work-items/{task['id']}", {"parent_id": m2["id"]}, auth)
    assert r.status_code == 200
    assert r.json()["parent_id"] == m2["id"]


@pytest.mark.django_db
def test_patch_description(client, project, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="T"),
        auth,
    ).json()

    r = patch_json(
        client,
        f"{BASE}/work-items/{task['id']}",
        {"description": "## hi"},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["description"] == "## hi"


@pytest.mark.django_db
def test_delete_work_item(client, project, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="T"),
        auth,
    ).json()

    r = client.delete(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert r.status_code == 204

    gone = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert gone.status_code == 404


@pytest.mark.django_db
def test_delete_non_empty_issue_is_blocked(client, project, module, task_type, auth):
    parent = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        _task_body(task_type, name="Story"),
        auth,
    ).json()
    child = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        _task_body(task_type, name="Sub", parent_id=parent["id"]),
        auth,
    ).json()

    # Deleting an issue that still has children is blocked (S5 · no subtree loss).
    r = client.delete(f"{BASE}/work-items/{parent['id']}", headers=auth)
    assert r.status_code == 409

    # Nothing was deleted — both rows survive.
    assert client.get(f"{BASE}/work-items/{parent['id']}", headers=auth).status_code == 200
    assert client.get(f"{BASE}/work-items/{child['id']}", headers=auth).status_code == 200


@pytest.mark.django_db
def test_delete_missing_is_404(client, auth):
    r = client.delete(f"{BASE}/work-items/{uuid.uuid4()}", headers=auth)
    assert r.status_code == 404


@pytest.mark.django_db
def test_missing_work_item_404_carries_the_domain_message(client, project, auth):
    """A service not-found reaches the client with its own message, not "Not Found".

    These routes reach the client through ``NotFoundError`` and the single
    ``_http_errors()`` translation seam. A generic body here means a service
    raised a framework 404 that bypassed the seam.
    """

    missing = uuid.uuid4()

    patched = patch_json(client, f"{BASE}/work-items/{missing}", {"name": "x"}, auth)
    assert patched.status_code == 404
    assert patched.json()["detail"] == "Work item not found."

    deleted = client.delete(f"{BASE}/work-items/{missing}", headers=auth)
    assert deleted.status_code == 404
    assert deleted.json()["detail"] == "Work item not found."
