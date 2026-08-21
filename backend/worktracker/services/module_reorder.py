"""The write side of a project's Manual module order (#360).

:mod:`worktracker.module_order` decides how a project's modules are *read*.
This module owns the one write that can change that answer: dragging a module
into a new place.

A project reaches Manual module order exactly once, on its first module drag.
Until then its modules use the server's automatic newest-created-first order,
and their persisted ranks mean nothing. The first drag therefore carries a
*baseline*: the complete list of module ids in the order the user could
actually see. Freezing that baseline
into ranks, applying the requested move, and flipping the project to manual
mode all happen inside one transaction behind a project-row lock, so a project
can never persist a half-seeded arrangement.

Once the project is manual, a baseline is stale by definition and is ignored:
a later request moves only its own module against the ranks that are current
when it acquires the lock. That keeps concurrent drags on the established
per-module last-write-wins behavior instead of letting a loser's complete
order overwrite the winner's.
"""

from django.db import transaction

from worktracker.models import Issue, ModulePresentation, Project
from worktracker.module_order import canonical_module_queryset
from worktracker.ranking import key_between, rebalance
from worktracker.services.errors import NotFoundError, ValidationError


def reorder_module(module_id, before_id=None, after_id=None, initial_order_ids=None):
    """Place one module between its neighbors, seeding manual mode if needed."""

    issue = Issue.objects.filter(pk=module_id, type="module").first()
    if issue is None:
        raise NotFoundError("Module not found.")

    if before_id is None and after_id is None:
        raise ValidationError("A module reorder requires at least one neighbor.")

    # An archived module is not in the order anyone can see, so it has nothing
    # to be dragged within. Rejecting it here — before the project row is even
    # locked — keeps an invisible module from seeding the active baseline into
    # ranks and flipping the project into manual mode on its way through.
    if issue.is_archived:
        raise ValidationError("An archived module cannot be reordered.")

    with transaction.atomic():
        project = (
            Project.objects.select_for_update().filter(pk=issue.project_id).first()
        )
        if project is None:
            raise NotFoundError("Project not found.")

        if (
            not ModulePresentation.objects.filter(
                module__project_id=project.id,
                module__type="module",
            )
            .exclude(rank="")
            .exists()
        ):
            _seed_manual_order(project.id, initial_order_ids)

        before = _module_neighbor(issue, before_id)
        after = _module_neighbor(issue, after_id)
        presentation = ModulePresentation.objects.get(module=issue)
        try:
            presentation.rank = key_between(
                _presentation_rank(before),
                _presentation_rank(after),
            )
        except ValueError as exc:
            raise ValidationError("before/after are not ordered neighbors.") from exc

        presentation.save(update_fields=["rank"])

    return presentation


def _seed_manual_order(project_id, initial_order_ids):
    """Freeze the caller's visible module order into ranks.

    The baseline must be exactly the project's active modules — no more, no
    fewer, no duplicates. That single set comparison is what rejects an
    incomplete list, a foreign project's module, a task work item, and a
    baseline built only from archived modules: none of those ids are in the
    active module set this project reads today.
    """

    if not initial_order_ids:
        raise ValidationError(
            "The first module reorder requires the visible module order."
        )

    ordered = [str(module_id) for module_id in initial_order_ids]
    if len(set(ordered)) != len(ordered):
        raise ValidationError("The module order baseline repeats a module.")

    active = {
        str(module_id)
        for module_id in canonical_module_queryset(project_id).values_list(
            "id", flat=True
        )
    }
    if set(ordered) != active:
        raise ValidationError(
            "The module order baseline must list exactly this project's active modules."
        )

    presentations_by_module_id = {
        str(presentation.module_id): presentation
        for presentation in ModulePresentation.objects.filter(module_id__in=ordered)
    }
    created = []
    updated = []
    for rank, module_id in zip(rebalance(len(ordered)), ordered):
        presentation = presentations_by_module_id.get(module_id)
        if presentation is None:
            presentation = ModulePresentation(module_id=module_id)
            created.append(presentation)
        else:
            updated.append(presentation)
        presentation.rank = rank
    ModulePresentation.objects.bulk_create(created)
    ModulePresentation.objects.bulk_update(updated, ["rank"])


def _module_neighbor(issue, neighbor_id):
    """Resolve one drop neighbor, rejecting anything not a sibling module."""

    if neighbor_id is None:
        return None
    neighbor = Issue.objects.filter(pk=neighbor_id).first()
    if neighbor is None:
        raise NotFoundError("Neighbor not found.")
    if neighbor.project_id != issue.project_id:
        raise ValidationError("Neighbor belongs to another project.")
    if neighbor.type != "module":
        raise ValidationError("A module may only be ranked against modules.")
    if neighbor.is_archived:
        # The canonical collection never shows an archived module, so it is
        # never a gap the user could drop into: honoring it would rank the
        # moved module against a position nobody can see.
        raise ValidationError("An archived module is not a drop neighbor.")
    return neighbor


def _presentation_rank(issue):
    if issue is None:
        return None
    try:
        return issue.presentation.rank or None
    except ModulePresentation.DoesNotExist as exc:
        raise ValidationError("A module order neighbor has no rank.") from exc
