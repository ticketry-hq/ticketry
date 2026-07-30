import uuid

import pytest

from worktracker.models import Project, Workspace
from worktracker.tests.conftest import BASE, post_json


PROJECT_KEY_RULE = "Project key must be exactly three letters, using only A-Z."


@pytest.fixture
def workspace(db):
    return Workspace.objects.create(
        id=uuid.uuid4(),
        slug="meml",
        name="meml",
    )


def create_project(client, auth, *, slug):
    return post_json(
        client,
        f"{BASE}/projects",
        {"name": "Project", "slug": slug, "workspace_slug": "meml"},
        auth,
    )


@pytest.mark.django_db
def test_create_project_accepts_three_uppercase_letters(client, auth, workspace):
    response = create_project(client, auth, slug="ABC")

    assert response.status_code == 200
    assert response.json()["slug"] == "ABC"
    assert Project.objects.get(id=response.json()["id"]).slug == "ABC"


@pytest.mark.django_db
def test_create_project_normalizes_lowercase_key(client, auth, workspace):
    response = create_project(client, auth, slug="cdn")

    assert response.status_code == 200
    assert response.json()["slug"] == "CDN"
    assert Project.objects.get(id=response.json()["id"]).slug == "CDN"


@pytest.mark.django_db
@pytest.mark.parametrize("slug", ["AB", "ABCD", "A1C", "A-C"])
def test_create_project_rejects_keys_outside_the_rule(
    client,
    auth,
    workspace,
    slug,
):
    response = create_project(client, auth, slug=slug)

    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == PROJECT_KEY_RULE
    assert not Project.objects.filter(workspace=workspace).exists()


@pytest.mark.django_db
def test_create_project_reports_normalized_duplicate_key(client, auth, workspace):
    Project.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name="Existing",
        slug="CDN",
    )

    response = create_project(client, auth, slug="cdn")

    assert response.status_code == 409
    assert response.json()["detail"] == "Project slug 'CDN' already exists."
    assert Project.objects.filter(workspace=workspace, slug="CDN").count() == 1
