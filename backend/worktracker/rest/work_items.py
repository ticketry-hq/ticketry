"""Canonical DRF CRUD surface for task work items and attachments."""

import uuid

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from worktracker.rest.serializers import (
    AttachmentSerializer,
    WorkItemBatchSerializer,
    WorkItemCreateSerializer,
    WorkItemPatchSerializer,
    WorkItemSerializer,
)
from worktracker.services.attachments import create_attachment, list_attachments
from worktracker.services.work_items import (
    batch_work_items,
    create_work_item,
    delete_work_item,
    list_work_items,
    retrieve_work_item,
    update_work_item,
)


def _uuid_query(request, name):
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise DRFValidationError({name: "Must be a valid UUID."})


def _bool_query(request, name, default=False):
    value = request.query_params.get(name)
    if value is None:
        return default
    normalized = value.casefold()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    raise DRFValidationError({name: "Must be true or false."})


class WorkItemListView(APIView):
    """The only task collection read, narrowed by declared query parameters."""

    @extend_schema(
        operation_id="listWorkItems",
        tags=["Work Items"],
        parameters=[
            OpenApiParameter("project", uuid.UUID, required=False),
            OpenApiParameter("module", uuid.UUID, required=False),
            OpenApiParameter("state", uuid.UUID, required=False),
            OpenApiParameter("include_archived", bool, required=False, default=False),
            OpenApiParameter("include_pathfind", bool, required=False, default=False),
        ],
        responses=WorkItemSerializer(many=True),
    )
    def get(self, request):
        project_id = _uuid_query(request, "project")
        module_id = _uuid_query(request, "module")
        state_id = _uuid_query(request, "state")
        items = list_work_items(
            project_id=project_id,
            module_id=module_id,
            state_id=state_id,
            include_archived=_bool_query(request, "include_archived"),
            include_pathfind=_bool_query(request, "include_pathfind"),
        )
        return Response(WorkItemSerializer(items, many=True).data)


class WorkItemBatchView(APIView):
    """Read up to one hundred task work items by exact id in one request."""

    @extend_schema(
        operation_id="batchWorkItems",
        tags=["Work Items"],
        request=WorkItemBatchSerializer,
        responses=WorkItemSerializer(many=True),
    )
    def post(self, request):
        serializer = WorkItemBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = batch_work_items(serializer.validated_data["ids"])
        return Response(WorkItemSerializer(items, many=True).data)


class WorkItemCreateView(APIView):
    """Create an ordinary task or an absorbed review finding."""

    @extend_schema(
        operation_id="createWorkItem",
        tags=["Work Items"],
        request=WorkItemCreateSerializer,
        responses={201: WorkItemSerializer},
    )
    def post(self, request, project_id):
        serializer = WorkItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue = create_work_item(project_id, **serializer.validated_data)
        return Response(
            WorkItemSerializer(issue).data,
            status=status.HTTP_201_CREATED,
        )


class WorkItemDetailView(APIView):
    """Retrieve, update, or delete one bare work item."""

    @extend_schema(
        operation_id="getWorkItem", tags=["Work Items"], responses=WorkItemSerializer
    )
    def get(self, request, issue_id):
        return Response(WorkItemSerializer(retrieve_work_item(issue_id)).data)

    @extend_schema(
        operation_id="updateWorkItem",
        tags=["Work Items"],
        request=WorkItemPatchSerializer,
        responses=WorkItemSerializer,
    )
    def patch(self, request, issue_id):
        serializer = WorkItemPatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue = update_work_item(issue_id, **serializer.validated_data)
        return Response(WorkItemSerializer(issue).data)

    @extend_schema(
        operation_id="deleteWorkItem", tags=["Work Items"], responses={204: None}
    )
    def delete(self, request, issue_id):
        delete_work_item(issue_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttachmentCollectionView(APIView):
    """Read or append attachment rows without re-reading their work item."""

    @extend_schema(
        operation_id="listWorkItemAttachments",
        tags=["Attachments"],
        responses=AttachmentSerializer(many=True),
    )
    def get(self, request, issue_id):
        attachments = list_attachments(issue_id)
        return Response(AttachmentSerializer(attachments, many=True).data)

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
    def post(self, request, issue_id):
        uploaded = request.FILES.get("file")
        if uploaded is None:
            raise DRFValidationError({"file": "This field is required."})
        attachment = create_attachment(
            issue_id,
            uploaded,
            filename=request.data.get("name"),
        )
        return Response(
            AttachmentSerializer(attachment).data,
            status=status.HTTP_201_CREATED,
        )
