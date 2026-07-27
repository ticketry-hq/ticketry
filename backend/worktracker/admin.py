from django.contrib import admin

from worktracker.models import (
    Assignee,
    Attachment,
    Issue,
    IssueType,
    Label,
    LaunchBinding,
    Project,
    State,
    Workspace,
)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("slug", "name")
    search_fields = ("slug", "name")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "workspace", "seq_counter")
    list_filter = ("workspace",)
    search_fields = ("name", "slug")


@admin.register(State)
class StateAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "project", "color")
    list_filter = ("group", "project")


@admin.register(IssueType)
class IssueTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "level", "project", "is_default", "sort_order", "color")
    list_filter = ("level", "project", "is_default")
    search_fields = ("name",)


@admin.register(LaunchBinding)
class LaunchBindingAdmin(admin.ModelAdmin):
    list_display = ("issue_type", "state", "agent", "model", "reasoning")
    list_filter = ("issue_type__project", "issue_type", "state", "agent")
    search_fields = ("prompt", "model")


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    # One admin covers both modules and tasks; the type filter is the split.

    list_display = ("sequence_id", "type", "issue_type", "name", "project", "parent", "state")
    list_filter = ("type", "project", "state")
    search_fields = ("name",)
    raw_id_fields = ("parent", "state", "issue_type", "assignees", "labels")


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("filename", "issue", "mime_type", "size")
    raw_id_fields = ("issue",)


@admin.register(Assignee)
class AssigneeAdmin(admin.ModelAdmin):
    list_display = ("display_name", "email")
    search_fields = ("display_name", "email")


@admin.register(Label)
class LabelAdmin(admin.ModelAdmin):
    list_display = ("name", "project")
    search_fields = ("name",)
