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
WORKTRACKER_API_TOKEN = ""
