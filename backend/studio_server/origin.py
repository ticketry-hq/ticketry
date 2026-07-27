"""Origin protection used by the packaged desktop sidecar only."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden
from django.utils.cache import patch_vary_headers


ALLOWED_HEADERS = "content-type, x-api-key"
ALLOWED_METHODS = "DELETE, GET, OPTIONS, PATCH, POST, PUT"


class DesktopOriginMiddleware:
    """Reject browser requests that are not from the configured desktop origin.

    Command-line readiness probes do not carry an ``Origin`` header and remain
    valid.  The setting is empty during ordinary browser development, so this
    middleware does not alter that runtime.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        expected_origin = getattr(settings, "MUXED_DESKTOP_ORIGIN", "")
        origin = request.headers.get("Origin")
        if expected_origin and origin and origin != expected_origin:
            return HttpResponseForbidden("desktop origin rejected")

        if (
            expected_origin
            and origin == expected_origin
            and request.method == "OPTIONS"
            and request.headers.get("Access-Control-Request-Method")
        ):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        if expected_origin and origin == expected_origin:
            response["Access-Control-Allow-Origin"] = expected_origin
            response["Access-Control-Allow-Headers"] = ALLOWED_HEADERS
            response["Access-Control-Allow-Methods"] = ALLOWED_METHODS
            patch_vary_headers(response, ("Origin",))
        return response
