import os
from pathlib import Path

from apps.settings_store.config import CONFIG_DIR
from studio_server.database import default_database_settings


# Muxed is a localhost developer tool; these defaults match that posture.
# Override via the environment when running anywhere that isn't a single-user
# local machine.
SECRET_KEY = os.getenv("MUXED_SECRET_KEY", "muxed-localhost-only")
DEBUG = os.getenv("MUXED_DEBUG", "true").lower() in ("1", "true", "yes")
ALLOWED_HOSTS = os.getenv("MUXED_ALLOWED_HOSTS", "*").split(",")
# The Django admin is a development affordance, not a product surface
# (T1419 / ADR-0013). It fails closed: every entrypoint that wants it — only
# ``scripts/dev.sh`` today — opts in explicitly, so starting this same code
# any other way against a packaged data dir cannot resurrect ``wt-admin/``.
ADMIN_ENABLED = os.getenv("MUXED_ADMIN_ENABLED", "false").lower() in (
    "1",
    "true",
    "yes",
)

ROOT_URLCONF = "studio_server.urls"
ASGI_APPLICATION = "studio_server.asgi.application"
SILENCED_SYSTEM_CHECKS = ["models.E034"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.admin",
    "channels",
    "rest_framework",
    "drf_spectacular",
    "apps.runs",
    "apps.terminals",
    "apps.documents",
    "apps.settings_store",
    "worktracker",
    "apps.worktrees",
    "apps.execution",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "studio_server.origin.DesktopOriginMiddleware",
    "worktracker.write_ownership.RustWorkTrackerWriteOwnershipMiddleware",
    "apps.settings_store.write_ownership.RustSlice2WriteOwnershipMiddleware",
    "apps.runs.write_ownership.RustSlice3WriteOwnershipMiddleware",
    "apps.workspace_write_ownership.RustSlice4WriteOwnershipMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]

# Templates — required by the Django admin (C9).

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Local-disk attachments (replaces MinIO) + admin static in dev.

MEDIA_ROOT = CONFIG_DIR / "media"
MEDIA_URL = "/media/"
STATIC_URL = "/static/"

# Static API token for the owned worktracker routes (C7); the bootstrap
# (#539) feeds it via the environment and persists it to the token file.

WORKTRACKER_API_TOKEN = os.environ.get("WORKTRACKER_API_TOKEN", "")
WORKTRACKER_DISABLE_AUTH = os.environ.get("WORKTRACKER_DISABLE_AUTH", "").lower() in {
    "1",
    "true",
    "yes",
}
WORKTRACKER_TOKEN_FILE = CONFIG_DIR / "worktracker_token"

# Empty in browser/dev mode.  The sidecar defaults this to Tauri's bundled
# document origin and permits a supervisor override for a custom protocol.
MUXED_DESKTOP_ORIGIN = os.environ.get("MUXED_DESKTOP_ORIGIN", "")

DATABASES = {
    "default": default_database_settings(
        Path(os.environ.get("MUXED_STATE_DB", CONFIG_DIR / "state.db"))
    )
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "worktracker.rest.authentication.ApiKeyAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "worktracker.rest.exceptions.service_exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Ticketry HTTP API",
    "VERSION": "0.1.0",
    "SCHEMA_PATH_PREFIX": r"^/api",
    "SCHEMA_PATH_PREFIX_TRIM": True,
    "SERVERS": [{"url": "/api"}],
}
