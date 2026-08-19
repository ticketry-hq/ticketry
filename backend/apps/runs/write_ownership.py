"""Shipping guard for the Rust Slice 3 one-writer Runs handoff.

After the handoff the in-process Rust runtime is the sole production writer for
Agent Run, Automation Attempt, Status Event, compaction-watermark, and Launch
Effect rows. This module is the refusal Django installs at its own boundary: no
ORM save, raw SQL, admin action, signal receiver, route, or MCP adapter may
reach one of those tables again, and there is no automatic downgrade back.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from django.http import JsonResponse


RUST_OWNER_ENV = "TICKETRY_RUST_SLICE3_OWNER"
READINESS_FILE = "slice3-readiness.json"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

#: Every table whose production writer transferred to Rust. Kept equal to the
#: checked Rust manifest in ``runs_persistence/ownership_manifest.rs``.
OWNED_TABLES = (
    "agent_runs",
    "automation_attempts",
    "runs_status_events",
    "runs_project_compaction_watermarks",
    "runs_launch_effects",
)

#: Legacy HTTP mutations of a transferred resource. Reads stay open: Studio's
#: status authority moved to GraphQL, but Python-owned capabilities still read
#: their own projections while their slices are outstanding.
OWNED_ROUTE_PREFIXES = (
    "/api/runs",
    "/api/agent-runs",
    "/api/automation-attempts",
    "/api/lifecycle",
)


def rust_owns_runs_writes() -> bool:
    return os.environ.get(RUST_OWNER_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def runs_commands_ready() -> bool:
    """Accept Runs effect commands only for the exact record Rust publishes."""

    if not rust_owns_runs_writes():
        return False
    data_directory = os.environ.get("MUXED_DATA_DIR")
    if not data_directory:
        return False
    try:
        readiness = json.loads((Path(data_directory) / READINESS_FILE).read_text())
    except (OSError, ValueError, TypeError):
        return False
    expected = {
        "version": 1,
        "runs_ownership": True,
        "effect_reconciliation": True,
        "graphql_status": True,
        "event_payload_version": 1,
        "compatibility_executor": True,
        "ready": True,
        "django_write_fallback": False,
    }
    if not isinstance(readiness, dict) or readiness.keys() != expected.keys():
        return False
    for key, value in expected.items():
        observed = readiness[key]
        if type(observed) is not type(value) or observed != value:
            return False
    return True


def assert_django_runs_write_allowed(table: str = "agent_runs") -> None:
    """Fail closed for every non-HTTP Runs writer after the handoff.

    Called by the DAO, the terminal persistence layer, the admin, and the
    retry command. It raises rather than returning a value so a writer that
    forgets to check still cannot proceed silently.
    """

    if rust_owns_runs_writes():
        raise RuntimeError(f"django_slice3_write_disabled:{table}")


class RustSlice3WriteOwnershipMiddleware:
    """Reject every legacy HTTP mutation of a transferred Runs resource."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._reject(request):
            return JsonResponse(
                {
                    "detail": (
                        "Agent Run, Automation Attempt, and launch-effect writes "
                        "are owned by the in-process Rust runtime."
                    ),
                    "code": "django_slice3_write_disabled",
                },
                status=410,
            )
        return self.get_response(request)

    @staticmethod
    def _reject(request) -> bool:
        if not rust_owns_runs_writes() or request.method in SAFE_METHODS:
            return False
        path = request.path.rstrip("/")
        return any(path.startswith(prefix) for prefix in OWNED_ROUTE_PREFIXES)
