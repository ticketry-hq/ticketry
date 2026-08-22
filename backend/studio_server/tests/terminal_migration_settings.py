"""Test-only settings for characterizing retired terminal migrations."""

from studio_server.settings import *  # noqa: F403


INSTALLED_APPS = [*INSTALLED_APPS, "apps.terminals"]  # noqa: F405
