"""Canonical DRF CRUD surface for task work items and attachments."""

import uuid

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from worktracker.models import Attachment
from worktracker.rest.serializers import (
    AttachmentSerializer,
    WorkItemCreateSerializer,
    WorkItemPatchSerializer,
    WorkItemSerializer,
)
from worktracker.services.work_items import (
    _get_issue,
    create_project_work_item,
    create_review_finding,
    delete_work_item,
    update_work_item,
)
from worktracker.work_items import resolve_issue, task_qs


def _uuid_query(request, name):
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({name: "Must be a valid UUID."})


def _bool_query(request, name, default=False):
    value = request.query_params.get(name)
    if value is None:
        return default
    normalized = value.casefold()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    from rest_framework.exceptions import ValidationError

    raise ValidationError({name: "Must be true or false."})


def _ordered_tasks() -> QuerySet:
    return task_qs().order_by("rank", "sequence_id", "id")


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
        queryset = _ordered_tasks()
        project_id = _uuid_query(request, "project")
        module_id = _uuid_query(request, "module")
        state_id = _uuid_query(request, "state")
        if project_id is not None:
            queryset = queryset.filter(project_id=project_id)
        if module_id is not None:
            queryset = queryset.filter(module_id=module_id)
        if state_id is not None:
            queryset = queryset.filter(state_id=state_id)
        if not _bool_query(request, "include_archived"):
            queryset = queryset.exclude(is_archived=True)
        if not _bool_query(request, "include_pathfind"):
            queryset = queryset.exclude(issue_type__name="PathFind")
        return Response(WorkItemSerializer(queryset, many=True).data)


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
        data = serializer.validated_data
        if not data.get("issue_type_id"):
            issue = create_review_finding(
                project_id,
                parent_id=data["parent_id"],
                name=data["name"],
                description=data.get("description") or "",
            )
        else:
            issue = create_project_work_item(
                project_id,
                name=data["name"],
                issue_type_id=data["issue_type_id"],
                state_id=data.get("state_id"),
                description=data.get("description"),
                parent_id=data.get("parent_id"),
            )
        return Response(
            WorkItemSerializer(resolve_issue(str(issue.id))).data,
            status=status.HTTP_201_CREATED,
        )


class WorkItemDetailView(APIView):
    """Retrieve, update, or delete one bare work item."""

    @extend_schema(
        operation_id="getWorkItem", tags=["Work Items"], responses=WorkItemSerializer
    )
    def get(self, request, issue_id):
        return Response(WorkItemSerializer(resolve_issue(issue_id)).data)

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
        return Response(WorkItemSerializer(resolve_issue(str(issue.id))).data)

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
        _get_issue(issue_id)
        attachments = Attachment.objects.filter(issue_id=issue_id).order_by(
            "created_at", "id"
        )
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
        issue = _get_issue(issue_id)
        uploaded = request.FILES.get("file")
        if uploaded is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"file": "This field is required."})
        attachment = Attachment.objects.create(
            id=uuid.uuid4(),
            issue=issue,
            file=uploaded,
            filename=request.data.get("name") or uploaded.name,
            mime_type=uploaded.content_type or "",
            size=uploaded.size,
        )
        return Response(
            AttachmentSerializer(attachment).data,
            status=status.HTTP_201_CREATED,
        )
