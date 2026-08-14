"""The single DRF seam for framework-neutral WorkTracker service errors."""

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from worktracker.services.errors import ServiceError


def service_exception_handler(exc, context):
    """Map service errors without changing their status or structured body."""

    if isinstance(exc, ServiceError):
        as_body = getattr(exc, "as_body", None)
        body = as_body() if callable(as_body) else {"detail": exc.message}
        return Response(body, status=exc.status_code)
    return drf_exception_handler(exc, context)
