"""Minimal settings used by the one-shot OpenAPI export command."""

SECRET_KEY = "worktracker-openapi-export"

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "apps.runs",
    "apps.terminals",
    "apps.documents",
    "apps.settings_store",
    "worktracker",
    "apps.worktrees",
    "apps.source_control",
    "apps.execution",
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
ROOT_URLCONF = "worktracker.rest.openapi_urls"

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
    "DESCRIPTION": "Canonical generated contract for every Ticketry HTTP route.",
    "VERSION": "0.1.0",
    "SCHEMA_PATH_PREFIX": r"^/api",
    "SCHEMA_PATH_PREFIX_TRIM": True,
    "ENUM_ADD_EXPLICIT_BLANK_NULL_CHOICE": False,
    "SERVERS": [{"url": "/api"}],
    # Name these enums for what they are, not for their field. Without the
    # source-control entry, a second `status` field would rename the unrelated
    # automation-attempt `StatusEnum` across the generated SDKs.
    "ENUM_NAME_OVERRIDES": {
        "GraphRunExecutionModeEnum": "apps.execution.execution_mode.EXECUTION_MODE_CHOICES",
        "ChangedFileStatusEnum": "apps.source_control.change_status.CHANGE_STATUS_CHOICES",
        # Pinned so a second `status` enum anywhere in the backend cannot
        # rename this one out from under the generated SDKs.
        "StatusEnum": "apps.runs.models.AutomationAttempt.Status",
    },
}
