"""Framework-neutral module mutation services."""

import uuid

from worktracker.models import Issue, Project
from worktracker.sequences import allocate_sequence_id
from worktracker.services.errors import NotFoundError
from worktracker.work_items import resolve_issue_type


def create_module(project_id: uuid.UUID, name: str, issue_type_id=None):
    """Create a module issue for a project."""

    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist as exc:
        raise NotFoundError("Project not found.") from exc

    issue_type = resolve_issue_type(project.id, issue_type_id, "module")

    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name=name,
        sequence_id=allocate_sequence_id(project.id),
        issue_type=issue_type,
    )
