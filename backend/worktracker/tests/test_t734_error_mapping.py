"""#734 hardening: route handlers must map domain ServiceErrors to HTTP status.

These pin the two error-mapping seams that regressed when the create routes
were moved behind services: a service that raises a ServiceError must surface
as its mapped status, not a bare 500.
"""

import uuid

import pytest

from worktracker.models import IssueType
from worktracker.tests.conftest import BASE, post_json


@pytest.fixture
def module(client, project, auth):
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/modules",
        {"name": "Epic", "issue_type_id": str(module_type.id)},
        auth,
    )
    assert r.status_code == 200
    return r.json()


@pytest.mark.django_db
def test_create_module_work_item_wrong_level_type_maps_422(client, project, module, auth):
    """A module-level type on a task create must map to 422, not 500."""
    wrong = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="EpicType", level="module"
    )
    r = post_json(
        client,
        f"{BASE}/modules/{module['id']}/work-items",
        {"name": "Sub", "issue_type_id": str(wrong.id)},
        auth,
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_create_module_missing_project_maps_404(client, auth):
    """Creating a module under an absent project must map to 404, not 500."""
    r = post_json(
        client,
        f"{BASE}/projects/{uuid.uuid4()}/modules",
        {"name": "Epic", "issue_type_id": str(uuid.uuid4())},
        auth,
    )
    assert r.status_code == 404
