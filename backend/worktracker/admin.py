from django.contrib import admin

from worktracker.models import (
    Attachment,
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    State,
)


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "seq_counter")
    search_fields = ("name", "slug")


@admin.register(State)
class StateAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "project", "color")
    list_filter = ("group", "project")


@admin.register(IssueType)
class IssueTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "level", "project", "sort_order", "color")
    list_filter = ("level", "project")
    search_fields = ("name",)


@admin.register(LaunchBinding)
class LaunchBindingAdmin(admin.ModelAdmin):
    list_display = ("issue_type", "state", "model", "reasoning")
    list_filter = (
        "issue_type__project",
        "issue_type",
        "state",
        "model__provider",
    )
    search_fields = ("prompt", "model__name")


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    # One admin covers both modules and tasks; the type filter is the split.

    list_display = ("sequence_id", "type", "issue_type", "name", "project", "parent", "state")
    list_filter = ("type", "project", "state")
    search_fields = ("name",)
    raw_id_fields = ("parent", "state", "issue_type")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("filename", "issue", "mime_type", "size")
    raw_id_fields = ("issue",)
