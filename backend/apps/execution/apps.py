from django.apps import AppConfig


class ExecutionConfig(AppConfig):
    name = "apps.execution"

    def ready(self):
        from apps.execution import signals  # noqa: F401
