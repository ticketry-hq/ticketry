from django.contrib import admin

from apps.documents.models import DesignDocument


@admin.register(DesignDocument)
class DesignDocumentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "scope",
        "task_id",
        "module_id",
        "rel_path",
        "discovered_by_run_id",
        "updated_at",
    )
    list_filter = ("scope", "module_id", "task_id")
    search_fields = (
        "id",
        "module_id",
        "task_id",
        "root_dir",
        "rel_path",
        "discovered_by_run_id",
    )
    readonly_fields = ("id",)
