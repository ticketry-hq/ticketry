"""C2 — CRUD over the mounted router."""

import uuid

import pytest

from worktracker.models import Issue
from worktracker.tests.conftest import BASE, patch_json, post_json


@pytest.fixture
def module(client, project, auth):
    """Create one module and return its JSON."""
    r = post_json(client, f"{BASE}/projects/{project.id}/modules", {"name": "Epic"}, auth)
    assert r.status_code == 200
    return r.json()


@pytest.mark.django_db
def test_create_module(client, project, auth):
    r = post_json(client, f"{BASE}/projects/{project.id}/modules", {"name": "Epic"}, auth)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Epic"
    assert body["key"] == "MEML-1"


@pytest.mark.django_db
def test_create_task_and_retrieve_by_uuid(client, project, auth):
    created = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "Task"}, auth
    ).json()

    r = client.get(f"{BASE}/work-items/{created['id']}", headers=auth)
    assert r.status_code == 200
    assert r.json()["task"]["id"] == created["id"]
    assert "priority" not in created
    assert "priority" not in r.json()["task"]


@pytest.mark.django_db
def test_retrieve_by_key(client, project, auth):
    created = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "Task"}, auth
    ).json()

    r = client.get(f"{BASE}/work-items/{created['key']}", headers=auth)
    assert r.status_code == 200
    assert r.json()["task"]["id"] == created["id"]


@pytest.mark.django_db
def test_list_by_project(client, project, auth):
    post_json(client, f"{BASE}/projects/{project.id}/work-items", {"name": "A"}, auth)
    post_json(client, f"{BASE}/projects/{project.id}/work-items", {"name": "B"}, auth)

    r = client.get(f"{BASE}/projects/{project.id}/work-items", headers=auth)
    assert r.status_code == 200
    assert len(r.json()) == 2
    assert all("priority" not in item for item in r.json())


@pytest.mark.django_db
def test_list_by_module_returns_subtree(client, project, module, auth):
    task = post_json(
        client, f"{BASE}/modules/{module['id']}/work-items", {"name": "T"}, auth
    ).json()
    post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "Sub", "parent_id": task["id"]},
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
def test_project_create_rejects_retired_priority_without_writing(client, project, auth):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "Stale", "priority": "high"},
        auth,
    )

    _assert_retired_priority_error(r, "body")
    assert not Issue.objects.filter(project=project, name="Stale").exists()


@pytest.mark.django_db
def test_module_create_rejects_retired_priority_without_writing(
    client, project, module, auth
):
    r = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        {"name": "Stale", "priority": "high"},
        auth,
    )

    _assert_retired_priority_error(r, "body")
    assert not Issue.objects.filter(project=project, name="Stale").exists()


@pytest.mark.django_db
def test_patch_rejects_retired_priority_without_mutating(client, project, auth):
    task = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "Before"}, auth
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
    client, project, auth
):
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "Compatible", "unknown_field": "ignored"},
        auth,
    )

    assert r.status_code == 200
    assert r.json()["name"] == "Compatible"
    assert "priority" not in r.json()


@pytest.mark.django_db
def test_list_by_parent(client, project, module, auth):
    task = post_json(
        client, f"{BASE}/modules/{module['id']}/work-items", {"name": "T"}, auth
    ).json()

    r = client.get(
        f"{BASE}/projects/{project.id}/work-items?parent={module['id']}", headers=auth
    )
    assert r.status_code == 200
    body = r.json()
    assert [item["id"] for item in body] == [task["id"]]


@pytest.mark.django_db
def test_patch_state(client, project, state, auth):
    task = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()

    r = patch_json(
        client, f"{BASE}/work-items/{task['id']}", {"state_id": str(state.id)}, auth
    )
    assert r.status_code == 200
    assert r.json()["state"]["id"] == str(state.id)


@pytest.mark.django_db
def test_patch_parent_reparents(client, project, auth):
    m1 = post_json(client, f"{BASE}/projects/{project.id}/modules", {"name": "M1"}, auth).json()
    m2 = post_json(client, f"{BASE}/projects/{project.id}/modules", {"name": "M2"}, auth).json()
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "parent_id": m1["id"]},
        auth,
    ).json()

    r = patch_json(client, f"{BASE}/work-items/{task['id']}", {"parent_id": m2["id"]}, auth)
    assert r.status_code == 200
    assert r.json()["parent_id"] == m2["id"]


@pytest.mark.django_db
def test_patch_description(client, project, auth):
    task = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()

    r = patch_json(
        client,
        f"{BASE}/work-items/{task['id']}",
        {"description_html": "<p>hi</p>"},
        auth,
    )
    assert r.status_code == 200
    assert r.json()["description_html"] == "<p>hi</p>"


@pytest.mark.django_db
def test_delete_work_item(client, project, auth):
    task = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()

    r = client.delete(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert r.status_code == 204

    gone = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    assert gone.status_code == 404


@pytest.mark.django_db
def test_delete_non_empty_issue_is_blocked(client, project, module, auth):
    parent = post_json(
        client, f"{BASE}/modules/{module['id']}/work-items", {"name": "Story"}, auth
    ).json()
    child = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "Sub", "parent_id": parent["id"]},
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
