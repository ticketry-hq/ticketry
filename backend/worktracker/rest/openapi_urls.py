"""Production-shaped URL mount used by drf-spectacular contract export."""

from django.urls import include, path


urlpatterns = [
    path("api/work-tracker/", include("worktracker.rest.urls")),
]
