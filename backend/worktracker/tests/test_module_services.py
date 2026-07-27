import uuid

import pytest

from worktracker.models import IssueType
from worktracker.services.errors import NotFoundError, ValidationError
from worktracker.services.modules import create_module


@pytest.mark.django_db
def test_create_module_service_allocates_sequence_and_issue_type(project):
    module = create_module(project.id, "Epic")

    assert module.type == "module"
    assert module.project_id == project.id
    assert module.sequence_id == 1
    assert module.issue_type is None


@pytest.mark.django_db
def test_create_module_service_rejects_wrong_issue_type_level(project):
    task_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Task",
        level="task",
    )

    with pytest.raises(ValidationError) as excinfo:
        create_module(project.id, "Epic", issue_type_id=task_type.id)

    assert excinfo.value.status_code == 422


@pytest.mark.django_db
def test_create_module_service_missing_project_not_found():
    with pytest.raises(NotFoundError):
        create_module(uuid.uuid4(), "Epic")
