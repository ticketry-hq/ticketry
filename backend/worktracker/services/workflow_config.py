"""Framework-neutral workflow-configuration mutation services.

Owns the runtime policy behind state and issue-type configuration: valid
groups/levels, protected-state and last-state-in-group guards, reassignment
validation, and full-list reorder completeness. The API
layer decodes payloads and translates the raised :mod:`worktracker.services.errors`
onto the HTTP contract; the rules live here.
"""

import hashlib
import json
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
    Project,
    State,
)
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError
from worktracker.work_items import cascade_archive


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


def delete_issue_type(type_id, reassign_to=None):
    """Delete a type; conflict if it is in use without ``reassign_to``."""

    try:
        issue_type = IssueType.objects.get(pk=type_id)
    except IssueType.DoesNotExist:
        raise NotFoundError("Issue type not found.")

    in_use = Issue.objects.filter(issue_type=issue_type).count()
    if in_use and reassign_to is None:
        raise ConflictError(f"{in_use} issue(s) use this type; pass reassign_to to repoint them."
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


def get_state_impact(state_id):
    """Return the current consequences of deleting one shared workflow state."""

    try:
        state = State.objects.select_related("project").get(pk=state_id)
    except State.DoesNotExist:
        raise NotFoundError("State not found.")

    issues = list(
        Issue.objects.filter(state=state)
        .select_related("issue_type")
        .order_by("issue_type__name", "id")
    )
    grouped = {}
    for issue in issues:
        key = issue.issue_type_id
        grouped.setdefault(
            key,
            {
                "issue_type_id": key,
                "issue_type_name": issue.issue_type.name if issue.issue_type else None,
                "count": 0,
            },
        )["count"] += 1
    work_item_counts = sorted(
        grouped.values(),
        key=lambda item: (item["issue_type_name"] is not None, item["issue_type_name"] or ""),
    )

    workflow_references = []
    workflow_snapshots = []
    issue_types = (
        IssueType.objects.filter(project=state.project)
        .prefetch_related("transitions")
        .order_by("id")
    )
    for issue_type in issue_types:
        transitions = list(issue_type.transitions.all())
        roles = []
        if issue_type.start_state_id == state.id:
            roles.append("start")
        if any(edge.from_state_id == state.id for edge in transitions):
            roles.append("edge_source")
        if any(edge.to_state_id == state.id for edge in transitions):
            roles.append("edge_target")
        workflow_snapshots.append(
            {
                "issue_type_id": str(issue_type.id),
                "revision": issue_type.workflow_revision,
                "start_state_id": str(issue_type.start_state_id or ""),
                "transitions": sorted(
                    (
                        str(edge.from_state_id),
                        str(edge.to_state_id),
                        edge.agent_allowed,
                    )
                    for edge in transitions
                ),
            }
        )
        if roles:
            workflow_references.append(
                {
                    "issue_type_id": issue_type.id,
                    "issue_type_name": issue_type.name,
                    "revision": issue_type.workflow_revision,
                    "roles": roles,
                }
            )
    workflow_references.sort(key=lambda item: item["issue_type_name"])

    siblings = State.objects.filter(project=state.project, group=state.group).exclude(
        pk=state.pk
    )
    replacements = list(
        State.objects.filter(project=state.project)
        .exclude(pk=state.pk)
        .order_by("sort_order", "created_at")
    )
    protection_rules = []
    if state.is_protected:
        protection_rules.append(
            {
                "code": "protected_state",
                "message": "Protected workflow states cannot be deleted.",
            }
        )
    if not siblings.exists():
        protection_rules.append(
            {
                "code": "last_state_in_group",
                "message": "The last workflow state in a group cannot be deleted.",
            }
        )
    if issues or workflow_references:
        protection_rules.append(
            {
                "code": "replacement_required",
                "message": "Occupied or workflow-referenced states require an explicit replacement.",
            }
        )

    token_source = {
        "state": {
            "id": str(state.id),
            "project_id": str(state.project_id),
            "name": state.name,
            "group": state.group,
            "color": state.color,
            "sort_order": state.sort_order,
            "is_protected": state.is_protected,
            "updated_at": state.updated_at.isoformat(),
        },
        "work_items": [
            {
                "id": str(issue.id),
                "issue_type_id": str(issue.issue_type_id),
            }
            for issue in issues
        ],
        "workflows": workflow_snapshots,
        "replacement_states": [
            {
                "id": str(candidate.id),
                "group": candidate.group,
                "sort_order": candidate.sort_order,
                "updated_at": candidate.updated_at.isoformat(),
            }
            for candidate in replacements
        ],
    }
    impact_token = hashlib.sha256(
        json.dumps(token_source, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "state_id": state.id,
        "impact_token": impact_token,
        "total_work_items": len(issues),
        "work_item_counts": work_item_counts,
        "workflow_references": workflow_references,
        "protection_rules": protection_rules,
        "valid_replacements": replacements,
    }


def _reassign_issue_for_state_deletion(issue, deleted_state, replacement_state):
    """Repair one issue whose current state is about to be deleted.

    This is configuration maintenance, not a workflow transition. Its guard is
    deliberately narrower than the transition service: it can only replace the
    exact state currently being deleted with another state in the same project.
    Saving the issue normally preserves revision and post-commit event behavior;
    the cancellation archive invariants match ordinary state entry and exit.
    """

    if issue.state_id != deleted_state.id:
        raise ValidationError(
            "State-deletion reassignment only applies to issues in the deleted state."
        )
    if (
        replacement_state.project_id != deleted_state.project_id
        or issue.project_id != deleted_state.project_id
        or replacement_state.id == deleted_state.id
    ):
        raise ValidationError(
            "State-deletion reassignment requires a different state in the same project."
        )

    old_group = deleted_state.group
    new_group = replacement_state.group
    issue.state = replacement_state
    entering_cancelled = old_group != "cancelled" and new_group == "cancelled"
    if entering_cancelled:
        issue.is_archived = True
    elif old_group == "cancelled" and new_group != "cancelled":
        issue.is_archived = False
    issue.save()
    if entering_cancelled:
        cascade_archive(issue)


def delete_state(state_id, reassign_to=None, impact_token=None):
    """Delete a state after confirming and repairing its current impact.

    Reassignment is a narrowly scoped configuration repair, not a user/agent
    workflow transition. Each affected issue is saved individually so revision,
    event, and cancellation-archive behavior stays intact; the operation cannot
    move an issue unless its current state is the state being deleted.
    """

    with transaction.atomic():
        try:
            state = State.objects.select_for_update().select_related("project").get(
                pk=state_id
            )
        except State.DoesNotExist:
            raise NotFoundError("State not found.")

        # A project lock makes state replacement one project-policy mutation;
        # the affected workflow and work-item rows are locked below as well.
        Project.objects.select_for_update().get(pk=state.project_id)
        # Lock every row represented by the preview token before recomputing
        # it. A concurrent move, graph edit, or replacement-candidate edit
        # therefore commits either wholly before this confirmation (token
        # mismatch) or after this transaction.
        list(
            State.objects.select_for_update()
            .filter(project=state.project)
            .order_by("id")
        )
        project_issues = list(
            Issue.objects.select_for_update()
            .filter(project=state.project)
            .select_related("issue_type")
            .order_by("id")
        )
        locked_issues = [issue for issue in project_issues if issue.state_id == state.id]
        issue_types = list(
            IssueType.objects.select_for_update()
            .filter(project=state.project)
            .order_by("id")
        )
        transitions = list(
            IssueTypeTransition.objects.select_for_update()
            .filter(issue_type__project=state.project)
            .order_by("issue_type_id", "id")
        )
        impact = get_state_impact(state.id)
        rule_codes = {rule["code"] for rule in impact["protection_rules"]}
        if "protected_state" in rule_codes:
            raise ConflictError(
                f"State '{state.name}' is protected and cannot be deleted."
            )
        if "last_state_in_group" in rule_codes:
            raise ConflictError("Cannot delete the last state in its group.")

        replacement_required = "replacement_required" in rule_codes
        if replacement_required and reassign_to is None:
            raise ConflictError(
                "Occupied or workflow-referenced states require an explicit replacement."
            )
        if replacement_required and impact_token is None:
            raise ConflictError(
                "A fresh state impact preview must be confirmed before replacement."
            )
        if impact_token is not None and not secrets.compare_digest(
            impact["impact_token"], impact_token
        ):
            raise ConflictError(
                "State impact changed after preview; refresh the impact and confirm again."
            )

        target = None
        if reassign_to is not None:
            try:
                target = State.objects.select_for_update().get(
                    pk=reassign_to, project=state.project
                )
            except State.DoesNotExist:
                raise NotFoundError("reassign_to state not found.")
            if target.pk == state.pk:
                raise ValidationError("A state cannot replace itself.")

        for issue_type in issue_types:
            type_transitions = [
                edge for edge in transitions if edge.issue_type_id == issue_type.id
            ]
            referenced = issue_type.start_state_id == state.id or any(
                edge.from_state_id == state.id or edge.to_state_id == state.id
                for edge in type_transitions
            )
            if not referenced:
                continue
            if target is None:
                raise ConflictError(
                    "Workflow-referenced states require an explicit replacement."
                )

            if issue_type.start_state_id == state.id:
                issue_type.start_state = target

            repaired_edges = {}
            for edge in type_transitions:
                source_id = (
                    target.id if edge.from_state_id == state.id else edge.from_state_id
                )
                destination_id = (
                    target.id if edge.to_state_id == state.id else edge.to_state_id
                )
                if source_id == destination_id:
                    continue
                key = (source_id, destination_id)
                repaired_edges[key] = (
                    repaired_edges.get(key, True) and edge.agent_allowed
                )
            IssueTypeTransition.objects.filter(issue_type=issue_type).delete()
            IssueTypeTransition.objects.bulk_create(
                IssueTypeTransition(
                    issue_type=issue_type,
                    from_state_id=source_id,
                    to_state_id=destination_id,
                    agent_allowed=agent_allowed,
                )
                for (source_id, destination_id), agent_allowed in repaired_edges.items()
            )
            issue_type.workflow_revision += 1
            issue_type.save(
                update_fields=["start_state", "workflow_revision", "updated_at"]
            )

        if target is not None:
            for issue in locked_issues:
                _reassign_issue_for_state_deletion(issue, state, target)

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

    rows = {row.id: row for row in model.objects.filter(project_id=project_id)}
    given = list(ordered_ids)

    if len(given) != len(rows) or set(given) != set(rows):
        raise ValidationError("ordered_ids must be exactly this project's rows.")

    with transaction.atomic():
        for index, row_id in enumerate(given):
            row = rows[row_id]
            if row.sort_order != index:
                row.sort_order = index
                row.save(update_fields=["sort_order"])
