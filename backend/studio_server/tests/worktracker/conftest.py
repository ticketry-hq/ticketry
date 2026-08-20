"""Host-side fixtures for the mounted WorkTracker API.

These tests exercise DRF through the Django host (URLConf and settings). No
production code lives here — only the wiring is exercised.
"""

import json
import uuid

import pytest
from django.test import Client

from worktracker.models import IssueType, Project, State


TOKEN = "test-token"
BASE = "/api/work-tracker"


def openapi_path(schema, mounted_path):
    """Return the document-relative path for an absolute mounted API path."""

    server_base = schema["servers"][0]["url"].rstrip("/")
    if not mounted_path.startswith(f"{server_base}/"):
        raise AssertionError(
            f"{mounted_path!r} is outside the OpenAPI server base {server_base!r}"
        )
    return mounted_path[len(server_base) :]


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

    return Project.objects.create(id=uuid.uuid4(), name="meml", slug="MEML")


@pytest.fixture
def state(project):
    """A 'Todo' state in the project's unstarted group."""

    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )


@pytest.fixture
def task_type(project):
    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )


@pytest.fixture
def module_type(project):
    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
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
