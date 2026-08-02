"""C3 — states: group enum enforced, list, assign via patch."""

import uuid

import pytest
from django.core.exceptions import ValidationError

from worktracker.models import Issue, State
from worktracker.tests.conftest import BASE, patch_json, post_json


@pytest.mark.django_db
def test_group_choices_enforced(project):
    bad = State(id=uuid.uuid4(), project=project, name="Weird", group="not_a_group")

    with pytest.raises(ValidationError):
        bad.full_clean()


@pytest.mark.django_db
def test_list_states(client, project, state, auth):
    r = client.get(f"{BASE}/projects/{project.id}/states", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body[0]["group"] == "unstarted"
    assert body[0]["name"] == "Todo"


@pytest.mark.django_db
def test_assign_state_via_patch(client, project, state, task_type, auth):
    task = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": "T", "issue_type_id": str(task_type.id)},
        auth,
    ).json()

    patch_json(client, f"{BASE}/work-items/{task['id']}", {"state_id": str(state.id)}, auth)

    assert Issue.objects.get(pk=task["id"]).state_id == state.id
