"""Installation onboarding state owned by the default project."""

from worktracker.models import Project
from worktracker.services.errors import ConflictError, NotFoundError


DEFAULT_PROJECT_SLUGS = ("CDN", "CODING")


def get_installation_default_project():
    """Return the canonical project, falling back to the oldest existing row."""

    for slug in DEFAULT_PROJECT_SLUGS:
        project = Project.objects.filter(slug=slug).order_by("created_at", "id").first()
        if project is not None:
            return project
    project = Project.objects.order_by("created_at", "id").first()
    if project is None:
        raise NotFoundError("Default project not found.")
    return project


def clear_onboarding(project):
    """Apply the project's monotonic pending-to-cleared transition."""

    Project.objects.filter(pk=project.pk, onboarding_required=True).update(
        onboarding_required=False
    )
    project.onboarding_required = False
    return project


def acknowledge_project_onboarding(project_id):
    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        raise NotFoundError("Project not found.")
    if project.pk != get_installation_default_project().pk:
        raise ConflictError("Onboarding belongs to the default project.")
    return clear_onboarding(project)
