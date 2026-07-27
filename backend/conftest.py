"""Shared pytest configuration for the Django server."""

import os
import tempfile
from pathlib import Path


TEST_DB = Path(tempfile.gettempdir()) / f"studio-server-{os.getpid()}.db"
os.environ["MUXED_STATE_DB"] = str(TEST_DB)
