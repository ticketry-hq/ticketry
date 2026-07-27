"""C4 — Out schemas mirror the frozen core pydantic shapes.

State is always one nested object — never a bare id, never a state_detail.
"""

import pytest
from studio_server.contracts import ModuleSummary, TaskSummary

from studio_server.tests.worktracker.conftest import BASE, post_json


@pytest.mark.django_db
def test_workitemout_matches_tasksummary(client, project, state, auth):
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "state_id": str(state.id)},
        auth,
    ).json()
    body = client.get(f"{BASE}/work-items/{created['id']}", headers=auth).json()["task"]

    # Every TaskSummary field is present in the work-item shape.
    assert set(TaskSummary.model_fields).issubset(body)

    # The shape round-trips into the frozen pydantic type with no gymnastics.
    TaskSummary(**body)

    # State is one nested object, never a bare id or a sibling state_detail.
    assert isinstance(body["state"], dict)
    assert "state_detail" not in body


@pytest.mark.django_db
def test_no_state_is_null_not_state_detail(client, project, auth):
    body = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()

    # No state assigned -> consistent null, never a bare id or state_detail.
    assert body["state"] is None
    assert "state_detail" not in body


@pytest.mark.django_db
def test_state_is_one_nested_object(client, project, state, auth):
    created = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "state_id": str(state.id)},
        auth,
    ).json()

    assert isinstance(created["state"], dict)
    assert created["state"]["group"] == "unstarted"
    assert "state_detail" not in created


@pytest.mark.django_db
def test_moduleout_matches_modulesummary(client, project, auth):
    body = post_json(
        client, f"{BASE}/projects/{project.id}/modules", {"name": "Epic"}, auth
    ).json()

    assert set(ModuleSummary.model_fields).issubset(body)
    ModuleSummary(**{k: body[k] for k in ModuleSummary.model_fields})


@pytest.mark.django_db
def test_task_shape_omits_retired_priority(client, project, auth):
    body = post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()

    assert "priority" not in body
