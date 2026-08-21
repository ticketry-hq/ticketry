"""DRF ViewSet for live worktree operations."""

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.worktrees import api as worktrees
from apps.worktrees.rest_serializers import (
    CreateWorktreeSerializer,
    DiscardSerializer,
    WorktreeContextQuerySerializer,
    WorktreeQuerySerializer,
    WorktreeStatusSerializer,
)


class WorktreeViewSet(viewsets.GenericViewSet):
    """Read, create, and discard task-scoped git worktrees."""

    serializer_class = WorktreeStatusSerializer

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
