"""DRF ViewSets for host-scoped settings resources."""

from asgiref.sync import async_to_sync
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.response import Response

from apps.settings_store import api
from apps.settings_store import module_links
from apps.settings_store.domain_ops import SettingsDomainActionMixin
from apps.settings_store.models import ModuleLink
from apps.settings_store.rest_serializers import (
    ModuleLinkSerializer,
    ModuleLinkWriteSerializer,
    SettingValueSerializer,
)


@extend_schema_view(
    retrieve=extend_schema(
        operation_id="settings_keybindings_retrieve",
        tags=["settings"],
        responses=SettingValueSerializer,
    ),
    update=extend_schema(
        operation_id="settings_keybindings_update",
        tags=["settings"],
        request=SettingValueSerializer,
        responses=SettingValueSerializer,
    ),
)
class KeybindingsViewSet(viewsets.GenericViewSet):
    """Retrieve or replace the installation's singleton keybindings value."""

    serializer_class = SettingValueSerializer

    def retrieve(self, request, *args, **kwargs):
        result = async_to_sync(api.get_keybindings)()
        return Response(self.get_serializer(result).data)

    def update(self, request, *args, **kwargs):
        request_serializer = self.get_serializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        result = async_to_sync(api.put_keybindings)(
            request_serializer.validated_data["value"]
        )
        return Response(self.get_serializer(result).data)


class SettingsViewSet(SettingsDomainActionMixin, viewsets.GenericViewSet):
    """Stateless settings operations that do not own a model resource."""

    serializer_class = SettingValueSerializer


@extend_schema_view(
    list=extend_schema(
        operation_id="module_links_list",
        tags=["module-links"],
    ),
    update=extend_schema(
        operation_id="module_links_upsert",
        tags=["module-links"],
        request=ModuleLinkWriteSerializer,
        responses=ModuleLinkSerializer,
    ),
    destroy=extend_schema(
        operation_id="module_links_delete",
        tags=["module-links"],
    ),
)
class ModuleLinkViewSet(
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """List and mutate host-local links addressed by their module identity."""

    queryset = ModuleLink.objects.select_related("module").order_by("created_at", "id")
    serializer_class = ModuleLinkSerializer
    lookup_field = "module_id"
    lookup_url_kwarg = "module_id"

    def get_object(self):
        if self.action != "update":
            return super().get_object()
        instance = (
            self.get_queryset().filter(module_id=self.kwargs["module_id"]).first()
        )
        if instance is None:
            instance = ModuleLink(module_id=self.kwargs["module_id"])
        self.check_object_permissions(self.request, instance)
        return instance

    def perform_update(self, serializer):
        serializer.instance = module_links.upsert_module_link(
            self.kwargs["module_id"],
            local_path=serializer.validated_data["local_path"],
        )

    def perform_destroy(self, instance):
        module_links.delete_module_link(instance.module_id)
