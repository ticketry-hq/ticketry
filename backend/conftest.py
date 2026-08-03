"""Shared pytest configuration for the Django server."""

import os
import tempfile
from pathlib import Path


TEST_DB = Path(tempfile.gettempdir()) / f"studio-server-{os.getpid()}.db"
os.environ["MUXED_STATE_DB"] = str(TEST_DB)
os.environ.pop("MUXED_DATABASE_URL", None)
os.environ.pop("MUXED_ENABLE_LOCAL_POSTGRES", None)
os.environ.pop("MUXED_FORCE_SQLITE", None)
os.environ["MUXED_DATABASE_URL_FILE"] = str(
    Path(tempfile.gettempdir()) / f"ticketry-no-database-url-{os.getpid()}"
)
