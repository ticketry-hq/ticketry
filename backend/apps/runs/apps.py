from django.apps import AppConfig


class RunsConfig(AppConfig):
    name = "apps.runs"

    def ready(self):
        """Register project-status adapters after Django models are ready."""

        from apps.runs import signals  # noqa: F401
