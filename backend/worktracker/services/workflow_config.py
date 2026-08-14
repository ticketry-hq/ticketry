"""Framework-neutral workflow-configuration mutation services.

Owns the runtime policy behind state and issue-type configuration: valid
groups/levels, protected-state, occupied-state, and last-state-in-group guards,
and full-list reorder completeness. The API
layer decodes payloads and translates the raised :mod:`worktracker.services.errors`
onto the HTTP contract; the rules live here.
"""

import secrets
import uuid

from django.db import transaction
from django.db.models import Max

from worktracker.models import (
    CARBON_DARK_PALETTE,
    GROUP_CHOICES,
    LEVEL_CHOICES,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    State,
)
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError


def _get_project(project_id):
    try:
        return Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        raise NotFoundError("Project not found.")


# --- issue types ------------------------------------------------------------


def create_issue_type(project_id, *, name, level, color=None):
    """Create an issue type at the tail of its level's order."""

    project = _get_project(project_id)

    if level not in dict(LEVEL_CHOICES):
        raise ValidationError(f"Unknown level '{level}'.")
    if IssueType.objects.filter(project=project, name=name).exists():
        raise ConflictError(f"Issue type '{name}' already exists.")

    max_order = IssueType.objects.filter(project=project, level=level).aggregate(
        m=Max("sort_order")
    )["m"]

    return IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name=name,
        level=level,
        color=color or "",
        sort_order=0 if max_order is None else max_order + 1,
    )


def update_issue_type(type_id, data):
    """Rename, recolor, or reorder an issue type."""

    try:
        issue_type = IssueType.objects.get(pk=type_id)
    except IssueType.DoesNotExist:
        raise NotFoundError("Issue type not found.")

    with transaction.atomic():
        if "name" in data:
            clash = (
                IssueType.objects.filter(project=issue_type.project, name=data["name"])
                .exclude(pk=issue_type.pk)
                .exists()
            )
            if clash:
                raise ConflictError(f"Issue type '{data['name']}' already exists.")
            issue_type.name = data["name"]
        if "color" in data:
            issue_type.color = data["color"] or ""
        if "sort_order" in data:
            issue_type.sort_order = data["sort_order"]
        issue_type.save()

    return issue_type


@transaction.atomic
def update_issue_type_configuration(
    type_id,
    changes,
    *,
    start_state_id=None,
    workflow_revision=None,
):
    """Apply row fields and an optional revision-guarded start-state edit."""

    if start_state_id is not None:
        # Local import keeps the two workflow service modules acyclic at import time.
        from worktracker.services.scoped_workflows import set_start_state

        set_start_state(
            type_id,
            state_id=start_state_id,
            workflow_revision=workflow_revision,
        )
    return update_issue_type(type_id, changes)


def delete_issue_type(type_id, reassign_to=None):
    """Delete a type; conflict if it is in use without ``reassign_to``."""

    try:
        issue_type = IssueType.objects.get(pk=type_id)
    except IssueType.DoesNotExist:
        raise NotFoundError("Issue type not found.")

    in_use = Issue.objects.filter(issue_type=issue_type).count()
    if in_use and reassign_to is None:
        raise ConflictError(
            f"{in_use} issue(s) use this type; pass reassign_to to repoint them."
        )

    with transaction.atomic():
        if reassign_to is not None:
            try:
                target = IssueType.objects.get(
                    pk=reassign_to, project=issue_type.project
                )
            except IssueType.DoesNotExist:
                raise NotFoundError("reassign_to type not found.")
            if target.level != issue_type.level:
                raise ValidationError("reassign_to must be the same level.")
            Issue.objects.filter(issue_type=issue_type).update(issue_type=target)
        issue_type.delete()


def reorder_issue_types(project_id, ordered_ids):
    """Rewrite every type's ``sort_order`` from the given full id order."""

    _get_project(project_id)
    _apply_reorder(IssueType, project_id, ordered_ids)
    return IssueType.objects.filter(project_id=project_id).order_by(
        "sort_order", "created_at"
    )


# --- states -----------------------------------------------------------------


def create_state(project_id, *, name, group, color=None):
    """Create a state in one of the five groups at the tail of the order."""

    if group not in dict(GROUP_CHOICES):
        raise ValidationError(f"Unknown group '{group}'.")

    with transaction.atomic():
        try:
            # Serialize automatic selection per project so concurrent creates
            # cannot observe the same unused palette entry.
            project = Project.objects.select_for_update().get(pk=project_id)
        except Project.DoesNotExist:
            raise NotFoundError("Project not found.")

        stored_color = color
        if color is None or not color.strip():
            used = {
                value.casefold()
                for value in State.objects.filter(project=project).values_list(
                    "color", flat=True
                )
                if value
            }
            available = [
                candidate
                for candidate in CARBON_DARK_PALETTE
                if candidate.casefold() not in used
            ]
            if not available:
                raise ConflictError(
                    "No automatic workflow-state colors remain for this project."
                )
            stored_color = secrets.choice(available)

        max_order = State.objects.filter(project=project).aggregate(
            m=Max("sort_order")
        )["m"]

        return State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            color=stored_color,
            sort_order=0 if max_order is None else max_order + 1,
        )


def update_state(state_id, data):
    """Rename / recolor / reorder a state, or move it among the five groups.

    ``data`` is the set-only field map (the API's ``exclude_unset`` dict).
    """

    try:
        state = State.objects.get(pk=state_id)
    except State.DoesNotExist:
        raise NotFoundError("State not found.")

    if "group" in data and data["group"] not in dict(GROUP_CHOICES):
        raise ValidationError(f"Unknown group '{data['group']}'.")

    if "name" in data:
        state.name = data["name"]
    if "group" in data:
        state.group = data["group"]
    if "sort_order" in data:
        state.sort_order = data["sort_order"]
    if "color" in data:
        state.color = data["color"] or ""
    state.save()

    return state


def delete_state(state_id):
    """Delete an empty, unreferenced state or name the blocking conflict."""

    with transaction.atomic():
        try:
            state = (
                State.objects.select_for_update()
                .select_related("project")
                .get(pk=state_id)
            )
        except State.DoesNotExist:
            raise NotFoundError("State not found.")

        # State creation and work-item sequence allocation use the same project
        # lock, keeping the guard checks and delete one project-policy mutation.
        Project.objects.select_for_update().get(pk=state.project_id)
        if state.is_protected:
            raise ConflictError(
                f"State '{state.name}' is protected and cannot be deleted."
            )
        if (
            not State.objects.filter(project=state.project, group=state.group)
            .exclude(pk=state.pk)
            .exists()
        ):
            raise ConflictError(
                f"State '{state.name}' is the last state in its group and cannot be deleted."
            )
        occupied = Issue.objects.filter(state=state).count()
        if occupied:
            raise ConflictError(
                f"State '{state.name}' is occupied by {occupied} work item(s) and cannot be deleted."
            )
        workflow_referenced = (
            IssueType.objects.filter(start_state=state).exists()
            or IssueTypeTransition.objects.filter(from_state=state).exists()
            or IssueTypeTransition.objects.filter(to_state=state).exists()
            or LaunchBinding.objects.filter(state=state).exists()
        )
        if workflow_referenced:
            raise ConflictError(
                f"State '{state.name}' is referenced by workflow configuration and cannot be deleted."
            )

        state.delete()


def reorder_states(project_id, ordered_ids):
    """Rewrite every state's ``sort_order`` from the given full id order."""

    _get_project(project_id)
    _apply_reorder(State, project_id, ordered_ids)
    return State.objects.filter(project_id=project_id).order_by(
        "sort_order", "created_at"
    )


def _apply_reorder(model, project_id, ordered_ids):
    """Validate ``ordered_ids`` is exactly the project's rows, then renumber them."""

    given = list(ordered_ids)

    with transaction.atomic():
        Project.objects.select_for_update().get(pk=project_id)
        rows = {
            row.id: row
            for row in model.objects.select_for_update().filter(project_id=project_id)
        }
        if len(given) != len(rows) or set(given) != set(rows):
            raise ValidationError("ordered_ids must be exactly this project's rows.")
        for index, row_id in enumerate(given):
            row = rows[row_id]
            if row.sort_order != index:
                row.sort_order = index
                row.save(update_fields=["sort_order"])
