"""Fixtures for the worktracker package tests.

Covers both the standalone model/sequence tests and the relocated
router/SDK integration suite, which exercises the ninja API through the
package's own minimal Django host (``worktracker.tests.urls``). No host
application is required — worktracker self-tests.
"""

import json
import uuid

import pytest
from django.test import Client

from worktracker.models import IssueType, Project, State, Workspace


TOKEN = "test-token"
BASE = "/api/work-tracker"


@pytest.fixture(autouse=True)
def wt_token(settings):
    """Configure a known API token for the auth check (C7)."""
    settings.WORKTRACKER_API_TOKEN = TOKEN
    settings.WORKTRACKER_DISABLE_AUTH = False


@pytest.fixture
def auth():
    """The valid API-key header."""
    return {"x-api-key": TOKEN}


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project(db):
    """Create a workspace + project (slug MEML) for issue tests."""

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


@pytest.fixture
def task_type(project):
    """An explicitly selectable task-level type for generic create tests."""

    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )


@pytest.fixture
def module_type(project):
    """The explicit module-level type used by module create tests."""

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
