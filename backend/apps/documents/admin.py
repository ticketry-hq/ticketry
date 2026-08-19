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

    # Rust is the only production writer for this table, so the admin is a
    # viewer. Add, change, and delete are refused here rather than left to fail
    # inside the model's own guard with an opaque server error.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
