"""DRF endpoints for installation-wide module presentation records."""

from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from worktracker.models import ModulePresentation
from worktracker.rest.reorder_serializers import ModulePresentationReorderSerializer
from worktracker.rest.serializers import (
    ModulePresentationSerializer,
    ModulePresentationWriteSerializer,
)
from worktracker.services.module_reorder import reorder_module
from worktracker.services.module_visibility import set_module_tab_hidden


@extend_schema_view(
    list=extend_schema(
        operation_id="listModulePresentations",
        tags=["Module Presentations"],
    ),
    update=extend_schema(
        operation_id="updateModulePresentation",
        tags=["Module Presentations"],
        request=ModulePresentationWriteSerializer,
        responses=ModulePresentationSerializer,
    ),
)
class ModulePresentationViewSet(
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """List and update presentation rows, and apply module rank moves."""

    queryset = (
        ModulePresentation.objects.filter(module__type="module")
        .select_related("module")
        .order_by("module__project_id", "module__id")
    )
    serializer_class = ModulePresentationSerializer
    lookup_field = "module_id"
    lookup_url_kwarg = "module_id"

    def get_serializer_class(self):
        if self.action == "update":
            return ModulePresentationWriteSerializer
        return ModulePresentationSerializer

    def get_object(self):
        if self.action != "update":
            return super().get_object()
        instance = self.get_queryset().filter(module_id=self.kwargs["module_id"]).first()
        if instance is None:
            instance = ModulePresentation(module_id=self.kwargs["module_id"])
        self.check_object_permissions(self.request, instance)
        return instance

    def perform_update(self, serializer):
        serializer.instance = set_module_tab_hidden(
            self.kwargs["module_id"],
            tab_hidden=serializer.validated_data["tab_hidden"],
        )

    @extend_schema(
        operation_id="reorderModulePresentation",
        tags=["Module Presentations"],
        request=ModulePresentationReorderSerializer,
        responses={200: ModulePresentationSerializer},
    )
    @action(detail=True, methods=["post"])
    def reorder(self, request, module_id):
        serializer = ModulePresentationReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        presentation = reorder_module(module_id, **serializer.validated_data)
        return Response(ModulePresentationSerializer(presentation).data)
