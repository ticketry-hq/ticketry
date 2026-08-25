"""DRF ViewSet for live worktree operations."""

from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.worktrees import api as worktrees
from apps.worktrees.models import Worktree
from apps.worktrees.rest_serializers import (
    ActiveWorktreeSerializer,
    CreateWorktreeSerializer,
    DiscardSerializer,
    WorktreeContextQuerySerializer,
    WorktreeQuerySerializer,
    WorktreeRecordQuerySerializer,
    WorktreeRecordSerializer,
    WorktreeStatusSerializer,
)


@extend_schema_view(
    list=extend_schema(
        operation_id="worktrees_records_list",
        tags=["worktrees"],
        parameters=[WorktreeRecordQuerySerializer],
    )
)
class WorktreeRecordViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """List persisted worktree owners for one module."""

    serializer_class = WorktreeRecordSerializer

    def get_queryset(self):
        query = WorktreeRecordQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        return Worktree.objects.filter(
            module_id=query.validated_data["module_id"]
        ).order_by("created_at")


class WorktreeViewSet(viewsets.GenericViewSet):
    """Read, create, and discard task-scoped git worktrees."""

    serializer_class = WorktreeStatusSerializer

    @extend_schema(
        operation_id="listModuleWorktrees",
        tags=["worktrees"],
        responses=ActiveWorktreeSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def module_worktrees(self, request, project_id=None, module_id=None):
        """List one module's active task worktrees."""

        worktree_rows = worktrees.list_active_worktrees(
            project_id=str(project_id),
            module_id=str(module_id),
        )
        return Response(ActiveWorktreeSerializer(worktree_rows, many=True).data)

    @extend_schema(
        operation_id="worktrees_retrieve",
        tags=["worktrees"],
        parameters=[WorktreeQuerySerializer],
        responses=WorktreeStatusSerializer,
    )
    @action(detail=False, methods=["get"])
    def status(self, request):
        query = WorktreeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = worktrees.get_worktree(**query.validated_data)
        return Response(WorktreeStatusSerializer(result).data)

    @extend_schema(
        operation_id="worktrees_create_create",
        tags=["worktrees"],
        request=CreateWorktreeSerializer,
        responses=WorktreeStatusSerializer,
    )
    @action(detail=True, methods=["post"])
    def create_worktree(self, request, task_id=None):
        serializer = CreateWorktreeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = worktrees.create_worktree(task_id, **serializer.validated_data)
        return Response(WorktreeStatusSerializer(result).data)

    @extend_schema(
        operation_id="worktrees_discard_create",
        tags=["worktrees"],
        parameters=[WorktreeContextQuerySerializer],
        request=None,
        responses=DiscardSerializer,
    )
    @action(detail=True, methods=["post"])
    def discard(self, request, task_id=None):
        query = WorktreeContextQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = worktrees.discard_worktree(task_id, **query.validated_data)
        return Response(DiscardSerializer(result).data)
