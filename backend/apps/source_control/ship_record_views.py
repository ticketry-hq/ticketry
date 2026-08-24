"""Project- and task-scoped reads for durable source-control history."""

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from worktracker.models import Issue

from apps.source_control.models import ShipRecord
from apps.source_control.ship_record_refresh import refresh_ship_record_pr_state
from apps.source_control.ship_record_serializers import (
    ShipRecordRefreshErrorSerializer,
    ShipRecordRefreshRequestSerializer,
    ShipRecordSerializer,
)


@extend_schema_view(
    list=extend_schema(operation_id="listModuleShipRecords", tags=["source-control"]),
)
class ModuleShipRecordViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """List one module's durable ship records, newest action first."""

    queryset = ShipRecord.objects.all()
    serializer_class = ShipRecordSerializer
    lookup_url_kwarg = "record_id"

    def get_queryset(self):
        return ShipRecord.objects.filter(
            module_id=self.kwargs["module_id"],
            module__project_id=self.kwargs["project_id"],
        ).order_by("-action_at", "-id")

    @extend_schema(
        operation_id="refreshShipRecordPullRequestState",
        tags=["source-control"],
        request=ShipRecordRefreshRequestSerializer,
        responses={
            200: ShipRecordSerializer,
            404: ShipRecordRefreshErrorSerializer,
            409: ShipRecordRefreshErrorSerializer,
            422: ShipRecordRefreshErrorSerializer,
            502: ShipRecordRefreshErrorSerializer,
            503: ShipRecordRefreshErrorSerializer,
            504: ShipRecordRefreshErrorSerializer,
        },
    )
    @action(detail=True, methods=["post"], url_path="refresh-pr-state")
    def refresh_pr_state(self, request, project_id, module_id, record_id):
        """Refresh one stored GitHub pull request state without polling."""

        serializer = ShipRecordRefreshRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = refresh_ship_record_pr_state(self.get_object())
        return Response(ShipRecordSerializer(record).data)


@extend_schema_view(
    list=extend_schema(operation_id="listTaskShipRecords", tags=["source-control"]),
)
class TaskShipRecordViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """List one task's ship records, newest action first."""

    queryset = ShipRecord.objects.all()
    serializer_class = ShipRecordSerializer

    def get_queryset(self):
        task = get_object_or_404(
            Issue.objects.only("id", "module_id"),
            id=self.kwargs["task_id"],
            project_id=self.kwargs["project_id"],
            type="task",
        )
        return ShipRecord.objects.filter(
            task_id=task.id,
            module_id=task.module_id,
            module__project_id=self.kwargs["project_id"],
        ).order_by("-action_at", "-id")
