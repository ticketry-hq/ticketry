from ninja import NinjaAPI

from apps.documents.api import router as documents_router
from apps.execution.api import router as execution_router
from apps.runs.api import router as runs_router
from apps.settings_store.api import router as settings_router
from apps.terminals.api import router as terminals_router
from apps.worktrees.api import router as worktrees_router
from apps.settings_store.config import NoConfigurationSelected


api = NinjaAPI(title="Ticketry backend", urls_namespace="api")
api.add_router("", settings_router)
api.add_router("", runs_router)
api.add_router("", terminals_router)
api.add_router("", documents_router)
api.add_router("", worktrees_router)
api.add_router("", execution_router)


@api.exception_handler(NoConfigurationSelected)
def no_profile_selected(request, exc):
    """Render an unresolved profile as a 400 error response."""
    return api.create_response(
        request,
        {"detail": {"error": "no_profile_selected", "message": exc.message}},
        status=400,
    )


@api.get("/healthz")
def healthz(request):
    """Return server health."""
    return {"ok": True}
