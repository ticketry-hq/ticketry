"""Minimal Django host for the standalone WorkTracker DRF package tests."""

from django.urls import include, path

urlpatterns = [
    path("api/work-tracker/", include("worktracker.rest.urls")),
]
