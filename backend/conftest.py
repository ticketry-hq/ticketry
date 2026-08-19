"""Shared pytest configuration for the Django server."""

import os
import tempfile
from pathlib import Path

import pytest


TEST_DB = Path(tempfile.gettempdir()) / f"studio-server-{os.getpid()}.db"
os.environ["MUXED_STATE_DB"] = str(TEST_DB)
os.environ.pop("MUXED_DATABASE_URL", None)
os.environ.pop("MUXED_ENABLE_LOCAL_POSTGRES", None)
os.environ.pop("MUXED_FORCE_SQLITE", None)
os.environ["MUXED_DATABASE_URL_FILE"] = str(
    Path(tempfile.gettempdir()) / f"ticketry-no-database-url-{os.getpid()}"
)


@pytest.fixture(autouse=True)
def seeded_provider_rows(request):
    """Restore data-migration provider rows after transactional migration tests."""

    if request.node.get_closest_marker("django_db") is None:
        return

    from django.db import connection

    from worktracker.models import Provider

    if Provider._meta.db_table not in connection.introspection.table_names():
        # Migration tests intentionally run with historical schemas.
        return

    for slug in ("claude", "agy", "codex", "gemini"):
        Provider.objects.update_or_create(
            slug=slug,
            defaults={
                "activated": slug in {"claude", "codex", "gemini"},
                "supports_unattended": True,
            },
        )


@pytest.fixture(autouse=True)
def local_rust_runs_runtime(monkeypatch):
    """Serve Runs commands locally instead of over the loopback Rust port.

    Rust owns every Runs table in shipping and runs in its own process, which
    this suite does not start. Substituting the port keeps every existing
    assertion about durable outcomes honest while proving the Django code
    reaches those tables only through the owner's command surface.
    """

    from apps.runs import rust_port
    from apps.runs.tests import fake_rust_runtime

    fake_rust_runtime.reset()
    for command in (
        "apply_lifecycle_fact",
        "record_terminal_outcome",
        "prepare_launch",
        "settle_launch",
        "launch",
        "materialize_attempt",
        "record_attempt_outcome",
    ):
        monkeypatch.setattr(
            rust_port, command, getattr(fake_rust_runtime, command)
        )
    yield
    fake_rust_runtime.reset()
