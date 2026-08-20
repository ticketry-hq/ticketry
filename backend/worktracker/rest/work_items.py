"""Canonical DRF ViewSets for task work items and attachments."""

import uuid

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from worktracker.rest.domain_ops import WorkItemDomainActionMixin
from worktracker.rest.work_item_serializers import (
    AttachmentSerializer,
    AttachmentUploadSerializer,
    WorkItemCreateSerializer,
    WorkItemFilterSerializer,
    WorkItemPatchSerializer,
    WorkItemSerializer,
)
from worktracker.services.attachments import create_attachment, list_attachments
from worktracker.services.work_items import (
    create_work_item,
    delete_work_item,
    list_work_items,
    retrieve_work_item,
    update_work_item,
)


@extend_schema_view(
    list=extend_schema(
        operation_id="listWorkItems",
        tags=["Work Items"],
        parameters=[
            OpenApiParameter("project", type=uuid.UUID, required=False),
            OpenApiParameter("module", type=uuid.UUID, required=False),
            OpenApiParameter("state", type=uuid.UUID, required=False),
        ],
    ),
    retrieve=extend_schema(operation_id="getWorkItem", tags=["Work Items"]),
    destroy=extend_schema(
        operation_id="deleteWorkItem", tags=["Work Items"], responses={204: None}
    ),
)
class WorkItemViewSet(
    WorkItemDomainActionMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Task CRUD with service-owned workflow and hierarchy invariants."""

    serializer_class = WorkItemSerializer
    lookup_url_kwarg = "issue_id"

    def get_serializer_class(self):
        return {
            "create": WorkItemCreateSerializer,
            "partial_update": WorkItemPatchSerializer,
        }.get(self.action, WorkItemSerializer)

    def get_queryset(self):
        if self.action != "list":
            return list_work_items(include_archived=True)
        filters = WorkItemFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        return list_work_items(
            project_id=values.get("project"),
            module_id=values.get("module"),
            state_id=values.get("state"),
            include_archived=True,
        )

    def get_object(self):
        return retrieve_work_item(self.kwargs["issue_id"])

    @extend_schema(
        operation_id="createWorkItem",
        tags=["Work Items"],
        request=WorkItemCreateSerializer,
        responses={201: WorkItemSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            WorkItemSerializer(serializer.instance).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_create(self, serializer):
        serializer.instance = create_work_item(
            self.kwargs["project_id"], **serializer.validated_data
        )

    @extend_schema(
        operation_id="updateWorkItem",
        tags=["Work Items"],
        request=WorkItemPatchSerializer,
        responses=WorkItemSerializer,
    )
    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(WorkItemSerializer(serializer.instance).data)

    def perform_update(self, serializer):
        serializer.instance = update_work_item(
            self.kwargs["issue_id"], **serializer.validated_data
        )

    def perform_destroy(self, instance):
        delete_work_item(instance.id)


@extend_schema_view(
    list=extend_schema(
        operation_id="listWorkItemAttachments",
        tags=["Attachments"],
        responses=AttachmentSerializer(many=True),
    )
)
class AttachmentViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Nested attachment collection for one work item."""

    serializer_class = AttachmentSerializer
    parser_classes = (MultiPartParser, FormParser)

    def get_serializer_class(self):
        return (
            AttachmentUploadSerializer
            if self.action == "create"
            else AttachmentSerializer
        )

    def get_queryset(self):
        return list_attachments(self.kwargs["issue_id"])

    @extend_schema(
        operation_id="uploadAttachment",
        tags=["Attachments"],
        request={
            "multipart/form-data": {
                "type": "object",
                "required": ["file"],
                "properties": {
                    "file": {"type": "string", "format": "binary"},
                    "name": {"type": "string"},
                },
            }
        },
        responses={201: AttachmentSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            AttachmentSerializer(serializer.instance).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_create(self, serializer):
        serializer.instance = create_attachment(
            self.kwargs["issue_id"],
            serializer.validated_data["file"],
            filename=serializer.validated_data.get("name"),
        )
