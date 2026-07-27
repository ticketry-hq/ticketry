"""Minimal Django host that mounts the worktracker router for tests.

Mirrors the path the host application mounts the router at
(``/api/work-tracker``) so the relocated router/SDK suite exercises the
same URLs without depending on the server package.
"""

from django.urls import path
from ninja import NinjaAPI

from worktracker.api import router as worktracker_router


api = NinjaAPI(urls_namespace="worktracker-test")
api.add_router("/work-tracker", worktracker_router)

urlpatterns = [
    path("api/", api.urls),
]
