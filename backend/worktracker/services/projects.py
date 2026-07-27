"""Framework-neutral project mutation services."""

import uuid

from django.db import IntegrityError, transaction

from worktracker.models import (
    DEFAULT_STATES,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    State,
    Workspace,
)
from worktracker.seed import (
    ensure_issue_types,
    ensure_launch_bindings,
    ensure_protected_states,
    ensure_state_order,
    ensure_type_workflows,
)
from worktracker.services.errors import ConflictError, NotFoundError


def _resolve_workspace(workspace_slug=None):
    if workspace_slug:
        try:
            return Workspace.objects.get(slug=workspace_slug)
        except Workspace.DoesNotExist:
            raise NotFoundError("Workspace not found.")

    workspace = Workspace.objects.order_by("created_at").first()
    if workspace is None:
        raise NotFoundError("No workspace to create the project under.")
    return workspace


def create_project(*, name, slug, description=None, workspace_slug=None):
    workspace = _resolve_workspace(workspace_slug)

    try:
        with transaction.atomic():
            project = Project.objects.create(
                id=uuid.uuid4(),
                workspace=workspace,
                name=name,
                slug=slug,
                description=description or "",
            )
            State.objects.bulk_create(
                State(
                    id=uuid.uuid4(),
                    project=project,
                    name=state_name,
                    group=group,
                    color=color,
                    sort_order=order,
                )
                for order, (state_name, group, color) in enumerate(DEFAULT_STATES)
            )
            ensure_state_order(project, State)
            ensure_issue_types(project, IssueType)
            ensure_protected_states(project, State)
            ensure_launch_bindings(project, IssueType, State, LaunchBinding)
            ensure_type_workflows(project, IssueType, State, IssueTypeTransition)
    except IntegrityError:
        raise ConflictError(f"Project slug '{slug}' already exists.")

    return project


def update_project(project_id, *, name=None, description=None):
    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        raise NotFoundError("Project not found.")

    if name is not None:
        project.name = name
    if description is not None:
        project.description = description or ""
    update_fields = ["updated_at"]
    if name is not None:
        update_fields.append("name")
    if description is not None:
        update_fields.append("description")
    project.save(update_fields=update_fields)
    return project


def delete_project(project_id):
    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        raise NotFoundError("Project not found.")
    project.delete()
