"""Host-side fixtures for the mounted worktracker router.

These tests exercise the router through the Django host (URLConf, settings,
ninja). No production code lives here — only the wiring is exercised.
"""

import json
import uuid

import pytest
from django.test import Client

from worktracker.models import Project, State, Workspace


TOKEN = "test-token"
BASE = "/api/work-tracker"


@pytest.fixture(autouse=True)
def wt_token(settings):
    """Configure a known API token for the auth check (C7)."""
    settings.WORKTRACKER_API_TOKEN = TOKEN


@pytest.fixture
def auth():
    """The valid API-key header."""
    return {"x-api-key": TOKEN}


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project(db):
    """A workspace + project (slug MEML)."""

    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")

    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )


@pytest.fixture
def state(project):
    """A 'Todo' state in the project's unstarted group."""

    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )


def post_json(client, url, body, auth):
    """POST a JSON body with the API-key header."""

    return client.post(
        url, data=json.dumps(body), content_type="application/json", headers=auth
    )


def patch_json(client, url, body, auth):
    """PATCH a JSON body with the API-key header."""

    return client.patch(
        url, data=json.dumps(body), content_type="application/json", headers=auth
    )
