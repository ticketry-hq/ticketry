"""Pytest settings that cannot inherit the user's shared Postgres opt-in."""

import os
import tempfile
from pathlib import Path

from studio_server.settings import *  # noqa: F403


DATABASES = {  # noqa: F405
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path(tempfile.gettempdir()) / f"studio-server-{os.getpid()}.db",
        "CONN_MAX_AGE": 0,
        "OPTIONS": {
            "init_command": (
                "PRAGMA journal_mode=WAL; "
                "PRAGMA busy_timeout=5000; "
                "PRAGMA foreign_keys=ON;"
            ),
        },
    }
}

# Most host-app tests exercise behavior below authentication. Dedicated auth
# suites opt back in explicitly; production remains closed by default.
WORKTRACKER_DISABLE_AUTH = True
