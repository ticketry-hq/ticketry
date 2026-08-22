"""Shipping guard for the Rust WorkTracker one-writer handoff."""

import os

from django.http import JsonResponse


RUST_OWNER_ENV = "TICKETRY_RUST_WORKTRACKER_OWNER"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
DJANGO_OWNED_CATALOG_PREFIXES = (
    "/api/work-tracker/providers",
    "/api/work-tracker/models",
    "/api/work-tracker/reasoning-levels",
)


def rust_owns_worktracker_writes() -> bool:
    return os.environ.get(RUST_OWNER_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


class RustWorkTrackerWriteOwnershipMiddleware:
    """Reject Django routes that could mutate a Rust-owned table."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._reject(request):
            return JsonResponse(
                {
                    "detail": "WorkTracker writes are owned by the in-process Rust runtime.",
                    "code": "django_worktracker_write_disabled",
                },
                status=410,
            )
        return self.get_response(request)

    @staticmethod
    def _reject(request) -> bool:
        if not rust_owns_worktracker_writes() or request.method in SAFE_METHODS:
            return False
        path = request.path.rstrip("/")
        if not path.startswith("/api/work-tracker/"):
            return False
        if path.startswith(DJANGO_OWNED_CATALOG_PREFIXES):
            return False
        return True
