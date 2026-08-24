from django.contrib import admin

from apps.source_control.models import ShipRecord


@admin.register(ShipRecord)
class ShipRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "module",
        "task",
        "checkout_kind",
        "branch",
        "action_at",
    )
    readonly_fields = tuple(field.name for field in ShipRecord._meta.fields)
