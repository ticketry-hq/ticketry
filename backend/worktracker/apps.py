from django.apps import AppConfig


class WorktrackerConfig(AppConfig):
    """App config for the owned work-tracking backend."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "worktracker"

    def ready(self):
        """Connect signal receivers by importing the signals module once.

        ``worktracker`` is the single auto-discovered ``AppConfig`` (it is the
        sole entry in ``INSTALLED_APPS``), so this import — and thus every
        ``@receiver`` connection in ``signals`` — runs exactly once at app load.
        """

        from worktracker import signals  # noqa: F401
