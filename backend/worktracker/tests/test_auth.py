"""C7 — static API-token auth across a GET and a POST."""

import json

import pytest

from worktracker.tests.conftest import BASE, TOKEN


@pytest.mark.django_db
def test_missing_token_401(client, project):
    assert client.get(f"{BASE}/projects").status_code == 401
    r = client.post(
        f"{BASE}/projects/{project.id}/modules",
        data=json.dumps({"name": "X"}),
        content_type="application/json",
    )
    assert r.status_code == 401


@pytest.mark.django_db
def test_wrong_token_401(client, project):
    bad = {"x-api-key": "nope"}
    assert client.get(f"{BASE}/projects", headers=bad).status_code == 401
    r = client.post(
        f"{BASE}/projects/{project.id}/modules",
        data=json.dumps({"name": "X"}),
        content_type="application/json",
        headers=bad,
    )
    assert r.status_code == 401


@pytest.mark.django_db
def test_valid_token_200(client, project, module_type):
    good = {"x-api-key": TOKEN}
    assert client.get(f"{BASE}/projects", headers=good).status_code == 200
    r = client.post(
        f"{BASE}/projects/{project.id}/modules",
        data=json.dumps({"name": "X", "issue_type_id": str(module_type.id)}),
        content_type="application/json",
        headers=good,
    )
    assert r.status_code == 201


@pytest.mark.django_db
def test_disable_auth_allows_missing_token(client, project, module_type, settings):
    settings.WORKTRACKER_DISABLE_AUTH = True

    assert client.get(f"{BASE}/projects").status_code == 200
    r = client.post(
        f"{BASE}/projects/{project.id}/modules",
        data=json.dumps({"name": "X", "issue_type_id": str(module_type.id)}),
        content_type="application/json",
    )
    assert r.status_code == 201
