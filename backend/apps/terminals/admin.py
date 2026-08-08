from django.contrib import admin

from apps.terminals.models import AgentRunViewerLease


@admin.register(AgentRunViewerLease)
class AgentRunViewerLeaseAdmin(admin.ModelAdmin):
    list_display = (
        "agent_run",
        "viewer_id",
        "transport",
        "acquired_at",
        "expires_at",
    )
    list_filter = ("transport",)
    search_fields = (
        "agent_run__id",
        "viewer_id",
    )
    raw_id_fields = ("agent_run",)
