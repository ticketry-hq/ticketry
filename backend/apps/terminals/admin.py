from django.contrib import admin

from apps.terminals.models import AgentTerminalSession


@admin.register(AgentTerminalSession)
class AgentTerminalSessionAdmin(admin.ModelAdmin):
    list_display = (
        "agent_run",
        "tmux_session_name",
        "agent",
        "project_id",
        "module_id",
        "task_id",
        "scope",
        "created_at",
        "terminated_at",
    )
    list_filter = ("agent", "scope", "project_id", "terminated_at")
    search_fields = (
        "agent_run__id",
        "tmux_session_name",
        "project_id",
        "module_id",
        "task_id",
    )
    raw_id_fields = ("agent_run",)
