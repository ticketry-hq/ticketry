"""CODIN-1029 workspace onboarding read and acknowledge API contract."""

import pytest

from worktracker.tests.conftest import BASE, patch_json, post_json


@pytest.mark.django_db
def test_workspace_onboarding_is_readable_before_project_selection(client, project, auth):
    workspace = project.workspace
    workspace.onboarding_required = True
    workspace.save(update_fields=["onboarding_required"])

    response = client.get(f"{BASE}/workspace", headers=auth)

    assert response.status_code == 200
    assert response.json() == {
        "id": str(workspace.id),
        "slug": "meml",
        "name": "meml",
        "onboarding_required": True,
    }


@pytest.mark.django_db
def test_acknowledge_onboarding_is_idempotent_and_false_only(client, project, auth):
    workspace = project.workspace
    workspace.onboarding_required = True
    workspace.save(update_fields=["onboarding_required"])

    first = post_json(client, f"{BASE}/workspace/onboarding/acknowledge", {}, auth)
    second = post_json(client, f"{BASE}/workspace/onboarding/acknowledge", {}, auth)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["onboarding_required"] is False
    assert second.json()["onboarding_required"] is False


@pytest.mark.django_db
def test_workspace_flag_has_no_client_write_surface(client, project, auth):
    workspace = project.workspace

    response = patch_json(
        client, f"{BASE}/workspace", {"onboarding_required": True}, auth
    )

    workspace.refresh_from_db()
    assert response.status_code == 405
    assert workspace.onboarding_required is False
