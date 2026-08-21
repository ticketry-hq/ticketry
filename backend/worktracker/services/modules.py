"""Framework-neutral module mutation services."""

import uuid

from django.db import transaction

from worktracker.models import Issue, ModulePresentation, Project
from worktracker.module_order import front_module_rank, uses_manual_module_order
from worktracker.sequences import allocate_sequence_id
from worktracker.services.errors import NotFoundError
from worktracker.work_items import resolve_issue_type


def create_module(project_id: uuid.UUID, name: str, issue_type_id):
    """Create a module issue at the front of the Canonical module order (#362).

    Front placement is one rule with two mechanisms, because the two ordering
    modes read different columns:

    * **Automatic** needs no rank at all. The collection read orders by
      descending ``sequence_id``, and this module just took the project's
      highest one, so it leads the server order the moment it is saved. Leaving
      ``rank`` at its default also keeps first-drag initialization free to seed
      the whole visible order later.
    * **Manual module order** needs a fractional rank before the current first
      active module, allocated here so a created module is never briefly last.

    Creation never changes the project's ordering mode: an automatic project
    stays automatic, and a manual one keeps the arrangement its users dragged.

    The mode read, the neighbor read, and the insert share one transaction.
    ``allocate_sequence_id`` locks the project row inside it, so two concurrent
    creates serialize on that row and cannot allocate the same front rank.
    """

    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist as exc:
        raise NotFoundError("Project not found.") from exc

    issue_type = resolve_issue_type(project.id, issue_type_id, "module")

    with transaction.atomic():
        sequence_id = allocate_sequence_id(project.id)
        presentation_rank = (
            front_module_rank(project.id)
            if uses_manual_module_order(project.id)
            else None
        )
        module = Issue.objects.create(
            id=uuid.uuid4(),
            project=project,
            type="module",
            name=name,
            sequence_id=sequence_id,
            issue_type=issue_type,
        )
        if presentation_rank is not None:
            ModulePresentation.objects.create(
                module=module,
                rank=presentation_rank,
            )
        return module
