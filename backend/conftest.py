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
