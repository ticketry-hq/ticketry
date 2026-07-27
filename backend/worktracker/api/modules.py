import uuid
from typing import List

from worktracker.api.router import _http_errors, router
from worktracker.models import Issue
from worktracker.schemas import ModuleIn, ModuleOut
from worktracker.services.modules import create_module as create_module_service


@router.get(
    "/projects/{project_id}/modules",
    response=List[ModuleOut],
    operation_id="listModules",
    tags=["Modules"],
)
def list_modules(request, project_id: uuid.UUID, include_archived: bool = False):
    """List the project's module issues (archived hidden unless requested)."""

    qs = Issue.objects.filter(project_id=project_id, type="module").select_related(
        "project", "issue_type"
    )

    if not include_archived:
        qs = qs.exclude(is_archived=True)

    return qs


@router.post(
    "/projects/{project_id}/modules",
    response=ModuleOut,
    operation_id="createModule",
    tags=["Modules"],
)
def create_module(request, project_id: uuid.UUID, payload: ModuleIn):
    """Create a module issue (no parent) with a freshly allocated sequence."""

    with _http_errors():
        return create_module_service(project_id, payload.name, payload.issue_type_id)
