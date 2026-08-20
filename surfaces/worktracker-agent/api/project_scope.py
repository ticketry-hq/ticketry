"""Select the one project exposed through Ticketry's agent surface."""

from collections.abc import Sequence
from typing import Any


INSTALLATION_PROJECT_SLUGS = ("CDN", "CODING")


def select_installation_project(projects: Sequence[Any]) -> Any | None:
    """Return Ticketry's installation project from an API-ordered collection."""

    by_slug = {project.slug.casefold(): project for project in projects}
    for slug in INSTALLATION_PROJECT_SLUGS:
        project = by_slug.get(slug.casefold())
        if project is not None:
            return project
    return projects[0] if projects else None
