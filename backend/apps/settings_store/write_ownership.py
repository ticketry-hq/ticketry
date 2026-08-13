"""Shipping guard for the Rust Slice 2 one-writer handoff."""

from __future__ import annotations

import json
import os
from pathlib import Path

from django.http import JsonResponse


RUST_OWNER_ENV = "TICKETRY_RUST_SLICE2_OWNER"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
OWNED_ROUTE_PREFIXES = (
    "/api/settings/",
    "/api/config",
    "/api/work-tracker/providers",
    "/api/work-tracker/models",
    "/api/work-tracker/reasoning-levels",
)


def rust_owns_slice2_writes() -> bool:
    return os.environ.get(RUST_OWNER_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def slice2_commands_ready() -> bool:
    """Accept commands only for the exact readiness record Rust publishes."""

    if not rust_owns_slice2_writes():
        return False
    data_directory = os.environ.get("MUXED_DATA_DIR")
    if not data_directory:
        return False
    try:
        readiness = json.loads(
            (Path(data_directory) / "slice2-readiness.json").read_text()
        )
    except (OSError, ValueError, TypeError):
        return False
    expected = {
        "version": 1,
        "ownership": True,
        "graphql": True,
        "rust_mcp": True,
        "django_effect_port": True,
        "ready": True,
        "django_write_fallback": False,
    }
    if not isinstance(readiness, dict) or readiness.keys() != expected.keys():
        return False
    if type(readiness["version"]) is not int or readiness["version"] != 1:
        return False
    return all(
        type(readiness[key]) is bool and readiness[key] is value
        for key, value in expected.items()
        if key != "version"
    )


def assert_django_settings_write_allowed() -> None:
    """Fail closed for non-HTTP callers after the production handoff."""

    if rust_owns_slice2_writes():
        raise RuntimeError("django_slice2_write_disabled")


class RustSlice2WriteOwnershipMiddleware:
    """Reject every legacy HTTP mutation of a Slice 2 resource."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._reject(request):
            return JsonResponse(
                {
                    "detail": (
                        "Settings, provider catalogue, and launch-policy writes "
                        "are owned by the in-process Rust runtime."
                    ),
                    "code": "django_slice2_write_disabled",
                },
                status=410,
            )
        return self.get_response(request)

    @staticmethod
    def _reject(request) -> bool:
        if not rust_owns_slice2_writes() or request.method in SAFE_METHODS:
            return False
        path = request.path.rstrip("/")
        return any(path.startswith(prefix) for prefix in OWNED_ROUTE_PREFIXES)
