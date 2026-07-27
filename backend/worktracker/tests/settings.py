"""Minimal Django settings so the package self-tests without the host.

Keeps worktracker genuinely standalone (the point of #540): models, sequence,
and provision run under the package's own pytest with an in-memory sqlite db.
"""

SECRET_KEY = "worktracker-test"

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "worktracker",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True

# Host the worktracker ninja router so the relocated router/SDK suite can
# reach it through Django's test client and live_server.
ROOT_URLCONF = "worktracker.tests.urls"

# Attachment URLs resolve under MEDIA_URL (C6); MEDIA_ROOT is set per-test.
MEDIA_URL = "/media/"

# A concrete STATIC_URL keeps live_server's static handler happy.
STATIC_URL = "/static/"

# Empty by default so provision exercises the generate-and-persist path.

WORKTRACKER_API_TOKEN = ""
