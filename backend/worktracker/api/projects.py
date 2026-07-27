import uuid
from typing import List

from ninja import Status

from worktracker.api.router import _http_errors, router
from worktracker.models import Project
from worktracker.schemas import ProjectIn, ProjectOut, ProjectPatch
from worktracker.services.projects import (
    create_project as create_project_service,
    delete_project as delete_project_service,
    update_project as update_project_service,
)


@router.get(
    "/projects",
    response=List[ProjectOut],
    operation_id="listProjects",
    tags=["Projects"],
)
def list_projects(request):
    """List all projects."""
    return Project.objects.all()


@router.post(
    "/projects",
    response=ProjectOut,
    operation_id="createProject",
    tags=["Projects"],
)
def create_project(request, payload: ProjectIn):
    """Create a project under a workspace and seed its 5 default states (G3).

    The workspace is named explicitly via ``workspace_slug`` or resolved to the
    sole workspace when omitted. A duplicate ``(workspace, slug)`` is rejected
    with ``409`` before insert; the new project starts at ``seq_counter = 0``.
    """
    with _http_errors():
        return create_project_service(
            name=payload.name,
            slug=payload.slug,
            description=payload.description,
            workspace_slug=payload.workspace_slug,
        )


@router.patch(
    "/projects/{project_id}",
    response=ProjectOut,
    operation_id="updateProject",
    tags=["Projects"],
)
def patch_project(request, project_id: uuid.UUID, payload: ProjectPatch):
    """Edit a project's name and/or markdown description (#665).

    Only the present fields are written; the slug/key stay immutable (G3) — slug
    is never read from the patch payload.
    """
    data = payload.dict(exclude_unset=True)
    with _http_errors():
        return update_project_service(project_id, **data)


@router.delete(
    "/projects/{project_id}",
    response={204: None},
    operation_id="deleteProject",
    tags=["Projects"],
)
def delete_project(request, project_id: uuid.UUID):
    """Permanently delete a project and everything it owns (#665).

    Unlike module/work-item delete, there is **no** child-count guard — this is
    the single-user local setup, and the operator gates the destruction with a
    typed-key confirm in the UI. The cascade is automatic: the project's States,
    IssueTypes, Labels and Issues (and each issue's Attachments) all
    declare ``on_delete=CASCADE``, so one delete clears the whole subtree.
    """
    with _http_errors():
        delete_project_service(project_id)
    return Status(204, None)
