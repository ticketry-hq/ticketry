"""Minimal settings used by the one-shot OpenAPI export command."""

SECRET_KEY = "worktracker-openapi-export"

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "worktracker",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
ROOT_URLCONF = "worktracker.tests.urls"
WORKTRACKER_API_TOKEN = ""
