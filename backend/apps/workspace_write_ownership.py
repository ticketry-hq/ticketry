"""Shipping guard for the Rust Slice 4 one-writer workspace handoff.

After the handoff the in-process Rust runtime is the sole production writer for
Design Document rows, Worktree rows, the Workspace Operation journal, and the two
adoption ledgers that record the transfer. This module is the refusal Django
installs at its own boundary: no ORM save, raw SQL, admin action, signal
receiver, DAO helper, or legacy route may reach one of those tables again, and
there is no automatic downgrade back.

The guard lives here, above both apps, because the transfer is one event. The
Documents registry, the Worktree index, and the shared operation journal were
adopted together and are validated against one composed Rust manifest, so a
single Python module keeps the Python half of that contract from drifting into
two half-answers.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from django.http import JsonResponse


RUST_OWNER_ENV = "TICKETRY_RUST_SLICE4_OWNER"
READINESS_FILE = "slice4-readiness.json"

#: Every table whose production writer transferred to Rust. Kept equal to the
#: composed Rust manifest in ``workspace_handoff/manifest.rs``.
OWNED_TABLES = (
    "design_documents",
    "ticketry_documents_adoption",
    "worktrees",
    "ticketry_worktrees_adoption",
    "workspace_operations",
    "ticketry_workspace_operations_schema",
)

#: The legacy HTTP surface for a transferred resource, retired whole rather than
#: by method.
#:
#: Unlike the Runs handoff, reads do not stay open here. Every one of these
#: routes writes: listing documents rescans authorized roots and prunes rows,
#: reading live worktree status prunes checkouts Git no longer knows about, and
#: directory completion is the trusted local read the desktop now owns. Leaving a
#: read open would leave a second reconciler.
OWNED_ROUTE_PREFIXES = (
    "/api/documents",
    "/api/docs",
    "/api/fs/complete",
    "/api/worktrees",
)


def rust_owns_workspace_writes() -> bool:
    return os.environ.get(RUST_OWNER_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def workspace_runtime_ready() -> bool:
    """Whether Rust published the exact complete Slice 4 readiness record.

    Nothing in Django needs this to decide a refusal — ownership alone decides
    that. It exists so an operator diagnosing a refused route can tell "Rust owns
    this and is serving it" from "Rust owns this and is not ready", without the
    two answers ever becoming a fallback.
    """

    if not rust_owns_workspace_writes():
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
        "documents_ownership": True,
        "worktree_ownership": True,
        "operation_journal_ownership": True,
        "ownership_validated": True,
        "status_outbox": True,
        "operation_reconciliation": True,
        "authorized_roots": True,
        "graphql_workspace": True,
        "asset_protocol": True,
        "document_watch": True,
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


def assert_django_workspace_write_allowed(table: str = "design_documents") -> None:
    """Fail closed for every non-HTTP workspace writer after the handoff.

    Called by the Documents and Worktrees DAOs, services, watcher, signal
    receivers, and admin actions. It raises rather than returning a value so a
    writer that forgets to check still cannot proceed silently.
    """

    if rust_owns_workspace_writes():
        raise RuntimeError(f"django_slice4_write_disabled:{table}")


class RustSlice4WriteOwnershipMiddleware:
    """Reject every legacy HTTP call against a transferred workspace resource."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._reject(request):
            return JsonResponse(
                {
                    "detail": (
                        "Design document and worktree traffic is owned by the "
                        "in-process Rust runtime."
                    ),
                    "code": "django_slice4_write_disabled",
                },
                status=410,
            )
        return self.get_response(request)

    @staticmethod
    def _reject(request) -> bool:
        if not rust_owns_workspace_writes():
            return False
        path = request.path.rstrip("/")
        return any(
            path == prefix or path.startswith(f"{prefix}/")
            for prefix in OWNED_ROUTE_PREFIXES
        )
