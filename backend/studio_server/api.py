"""Compatibility helpers retained after removal of the Ninja aggregator."""

from django.http import JsonResponse


def no_profile_selected(request, exc):
    """Render an unresolved profile as the established 400 error response."""

    return JsonResponse(
        {"detail": {"error": "no_profile_selected", "message": exc.message}},
        status=400,
    )
