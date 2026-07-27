from django.apps import AppConfig


class WorktreesConfig(AppConfig):
    name = "apps.worktrees"

    def ready(self):
        # Connect the auto-integrate-on-Done close hook (#589).
        from apps.worktrees import signals  # noqa: F401
