"""File-backed settings for the Rust/DRF shape-parity fixture builder."""

import os

from worktracker.tests.settings import *  # noqa: F403


DATABASES = {  # noqa: F405
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ["WORKTRACKER_PARITY_DATABASE"],
    }
}

WORKTRACKER_API_TOKEN = "test-token"
TIME_ZONE = "UTC"
