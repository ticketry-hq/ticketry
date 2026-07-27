from django.contrib import admin

from apps.runs.models import AgentRun


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "agent",
        "status",
        "project_id",
        "module_id",
        "task_id",
        "started_at",
        "ended_at",
    )
    list_filter = ("agent", "status", "project_id", "lifecycle_state")
    search_fields = (
        "id",
        "provider_session_id",
        "project_id",
        "module_id",
        "task_id",
        "cwd",
        "error",
    )
    readonly_fields = ("id",)
