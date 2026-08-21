"""Quarantined stateless settings operations exposed through DRF actions."""

from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.settings_store.module_folder_validation import validate_module_folder
from apps.settings_store.rest_serializers import (
    ModuleFolderValidationResultSerializer,
    ModuleFolderValidationSerializer,
)


class SettingsDomainActionMixin:
    """Expose host-folder validation without creating persistent state."""

    @extend_schema(
        operation_id="config_folders_validate_create",
        tags=["settings"],
        request=ModuleFolderValidationSerializer,
        responses=ModuleFolderValidationResultSerializer,
    )
    @action(detail=False, methods=["post"])
    def validate_folder(self, request):
        serializer = ModuleFolderValidationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = validate_module_folder(serializer.validated_data["path"])
        return Response(ModuleFolderValidationResultSerializer(result).data)
