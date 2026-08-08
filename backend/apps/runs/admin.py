from django.contrib import admin

from apps.runs.models import AgentRun


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "agent",
        "status",
        "issue",
        "scope",
        "terminal_owner_id",
        "started_at",
        "ended_at",
    )
    list_filter = ("agent", "status", "issue__project", "lifecycle_state")
    search_fields = (
        "id",
        "provider_session_id",
        "issue__id",
        "issue__name",
        "issue__project__name",
        "cwd",
        "doc_rel_path",
        "terminal_owner_id",
        "error",
    )
    readonly_fields = ("id",)
