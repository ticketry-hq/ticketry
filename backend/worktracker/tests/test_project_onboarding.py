"""Project-owned installation onboarding API contract."""

import uuid

import pytest

from worktracker.tests.conftest import BASE, patch_json, post_json
from worktracker.models import Project


@pytest.mark.django_db
def test_project_exposes_owned_onboarding_state(client, project, auth):
    project.onboarding_required = True
    project.save(update_fields=["onboarding_required"])

    response = client.get(f"{BASE}/projects", headers=auth)

    assert response.status_code == 200
    row = next(item for item in response.json() if item["id"] == str(project.id))
    assert row["onboarding_required"] is True
    assert "workspace_slug" not in row


@pytest.mark.django_db
def test_project_acknowledgement_is_idempotent_and_false_only(client, project, auth):
    project.onboarding_required = True
    project.save(update_fields=["onboarding_required"])
    url = f"{BASE}/projects/{project.id}/onboarding/acknowledge"

    first = post_json(client, url, {}, auth)
    second = post_json(client, url, {}, auth)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["onboarding_required"] is False
    assert second.json()["onboarding_required"] is False


@pytest.mark.django_db
def test_project_onboarding_flag_has_no_general_write_surface(client, project, auth):
    response = patch_json(
        client,
        f"{BASE}/projects/{project.id}",
        {"onboarding_required": True},
        auth,
    )

    project.refresh_from_db()
    assert response.status_code == 200
    assert project.onboarding_required is False


@pytest.mark.django_db
def test_extra_project_cannot_own_or_acknowledge_installation_onboarding(
    client, project, auth
):
    extra = Project.objects.create(
        id=uuid.uuid4(),
        name="Extra",
        slug="EXT",
        onboarding_required=True,
    )

    response = post_json(
        client,
        f"{BASE}/projects/{extra.id}/onboarding/acknowledge",
        {},
        auth,
    )

    extra.refresh_from_db()
    assert response.status_code == 409
    assert extra.onboarding_required is True
