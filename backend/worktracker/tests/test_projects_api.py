import uuid

import pytest

from worktracker.models import Project
from worktracker.tests.conftest import BASE, post_json


PROJECT_KEY_RULE = "Project key must be exactly three letters, using only A-Z."


def create_project(client, auth, *, slug):
    return post_json(
        client,
        f"{BASE}/projects",
        {"name": "Project", "slug": slug},
        auth,
    )


@pytest.mark.django_db
def test_create_project_accepts_three_uppercase_letters(client, auth, db):
    response = create_project(client, auth, slug="ABC")

    assert response.status_code == 201
    assert response.json()["slug"] == "ABC"
    assert Project.objects.get(id=response.json()["id"]).slug == "ABC"


@pytest.mark.django_db
def test_create_project_normalizes_lowercase_key(client, auth, db):
    response = create_project(client, auth, slug="cdn")

    assert response.status_code == 201
    assert response.json()["slug"] == "CDN"
    assert Project.objects.get(id=response.json()["id"]).slug == "CDN"


@pytest.mark.django_db
@pytest.mark.parametrize("slug", ["AB", "ABCD", "A1C", "A-C"])
def test_create_project_rejects_keys_outside_the_rule(
    client,
    auth,
    db,
    slug,
):
    response = create_project(client, auth, slug=slug)

    assert response.status_code == 400
    assert response.json()["slug"] == [PROJECT_KEY_RULE]
    assert not Project.objects.exists()


@pytest.mark.django_db
def test_create_project_reports_normalized_duplicate_key(client, auth, db):
    Project.objects.create(
        id=uuid.uuid4(),
        name="Existing",
        slug="CDN",
    )

    response = create_project(client, auth, slug="cdn")

    assert response.status_code == 409
    assert response.json()["detail"] == "Project slug 'CDN' already exists."
    assert Project.objects.filter(slug="CDN").count() == 1
