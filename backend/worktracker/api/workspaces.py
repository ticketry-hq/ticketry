from worktracker.api.router import _http_errors, router
from worktracker.schemas import WorkspaceOut
from worktracker.services.workspaces import (
    acknowledge_onboarding as acknowledge_onboarding_service,
    get_installation_workspace,
)


@router.get(
    "/workspace",
    response=WorkspaceOut,
    operation_id="getWorkspace",
    tags=["Workspace"],
)
def get_workspace(request):
    """Read installation-wide state before a project is selected."""
    with _http_errors():
        return get_installation_workspace()


@router.post(
    "/workspace/onboarding/acknowledge",
    response=WorkspaceOut,
    operation_id="acknowledgeWorkspaceOnboarding",
    tags=["Workspace"],
)
def acknowledge_onboarding(request):
    """Idempotently clear pending onboarding; no inverse action is exposed."""
    with _http_errors():
        return acknowledge_onboarding_service()
