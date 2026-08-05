"""WorkTracker API router package.

Importing this package registers every route module against the shared router.
"""

from worktracker.api.router import router

# Import route modules for their @router registrations.
from worktracker.api import modules as _modules  # noqa: F401
from worktracker.api import projects as _projects  # noqa: F401
from worktracker.api import workspaces as _workspaces  # noqa: F401


__all__ = ["router"]
