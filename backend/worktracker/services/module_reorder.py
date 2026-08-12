"""The write side of a project's Manual module order (#360).

:mod:`worktracker.module_order` decides how a project's modules are *read*.
This module owns the one write that can change that answer: dragging a module
into a new place.

A project reaches Manual module order exactly once, on its first module drag.
Until then its modules are ordered by the automatic fallback plus whatever
agent-activity recency Studio layers on top, and their persisted ranks mean
nothing. The first drag therefore carries a *baseline*: the complete list of
module ids in the order the user could actually see. Freezing that baseline
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

from worktracker.models import Issue, Project
from worktracker.module_order import canonical_module_queryset
from worktracker.ranking import key_between, rebalance
from worktracker.services.errors import NotFoundError, ValidationError


def reorder_module(issue, before_id=None, after_id=None, initial_order_ids=None):
    """Place one module between its neighbors, seeding manual mode if needed."""

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

        if not project.manual_module_order:
            _seed_manual_order(project.id, initial_order_ids)
            Project.objects.filter(pk=project.id).update(manual_module_order=True)

        before = _module_neighbor(issue, before_id)
        after = _module_neighbor(issue, after_id)
        try:
            issue.rank = key_between(
                (before.rank or None) if before else None,
                (after.rank or None) if after else None,
            )
        except ValueError as exc:
            raise ValidationError("before/after are not ordered neighbors.") from exc

        issue.save(update_fields=["rank", "updated_at"])

    return issue


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
            "The module order baseline must list exactly this project's "
            "active modules."
        )

    modules_by_id = {
        str(module.id): module for module in Issue.objects.filter(pk__in=ordered)
    }
    seeded = []
    for rank, module_id in zip(rebalance(len(ordered)), ordered):
        module = modules_by_id[module_id]
        module.rank = rank
        seeded.append(module)
    Issue.objects.bulk_update(seeded, ["rank"])


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
