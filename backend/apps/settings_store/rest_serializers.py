"""DRF serializers for host-scoped settings resources."""

from rest_framework import serializers

from apps.settings_store.models import ModuleLink


class SettingValueSerializer(serializers.Serializer):
    """Decoded value envelope for the singleton keybindings setting."""

    value = serializers.JSONField(allow_null=True)


class ModuleFolderValidationSerializer(serializers.Serializer):
    path = serializers.CharField()


class ModuleFolderValidationResultSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    reason = serializers.ChoiceField(
        choices=(
            "module_folder_not_absolute",
            "module_folder_missing",
            "module_folder_not_a_directory",
        ),
        allow_null=True,
    )


class ModuleLinkSerializer(serializers.ModelSerializer):
    """Explicit public allowlist for a host-local Module link."""

    module_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = ModuleLink
        fields = ["id", "module_id", "local_path", "created_at", "updated_at"]
        read_only_fields = ["id", "module_id", "created_at", "updated_at"]


class ModuleLinkWriteSerializer(serializers.ModelSerializer):
    """Generated PUT body containing only the caller-owned field."""

    class Meta:
        model = ModuleLink
        fields = ["local_path"]
