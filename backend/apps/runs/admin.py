"""Read-only admin for the Rust-owned Agent Run table.

Rust is the sole production writer after the Slice 3 handoff, so the admin
keeps its diagnostic listing and gives up every mutation: add, change, and
delete are all refused rather than silently writing behind the owner.
"""

from django.contrib import admin

from apps.runs.models import AgentRun


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "agent",
        "status",
        "issue",
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
        "error",
    )

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
