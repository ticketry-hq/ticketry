"""Framework-neutral installation workspace services."""

from worktracker.models import Workspace
from worktracker.services.errors import NotFoundError


def get_installation_workspace():
    workspace = Workspace.objects.order_by("created_at").first()
    if workspace is None:
        raise NotFoundError("Workspace not found.")
    return workspace


def clear_onboarding(workspace):
    """Apply the workspace's monotonic pending-to-cleared transition."""
    Workspace.objects.filter(pk=workspace.pk, onboarding_required=True).update(
        onboarding_required=False
    )
    workspace.onboarding_required = False
    return workspace


def acknowledge_onboarding():
    return clear_onboarding(get_installation_workspace())
