"""DRF ViewSet for reading a checkout's working-tree changes.

A task worktree and a module base checkout get their own actions rather than
one action with a mode flag: the checkout under review is then fixed by the
route, so no combination of query parameters can make one answer for the other.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.rest_serializers import ErrorEnvelopeSerializer
from apps.source_control import api as source_control
from apps.source_control.rest_serializers import (
    FileDiffQuerySerializer,
    FileDiffSerializer,
    ModuleChangesQuerySerializer,
    ModuleFileDiffQuerySerializer,
    WorktreeChangesQuerySerializer,
    WorktreeChangesSerializer,
)


_CHANGES_RESPONSES = {
    200: WorktreeChangesSerializer,
    413: ErrorEnvelopeSerializer,
    502: ErrorEnvelopeSerializer,
    503: ErrorEnvelopeSerializer,
    504: ErrorEnvelopeSerializer,
}

_FILE_DIFF_RESPONSES = {
    200: FileDiffSerializer,
    404: ErrorEnvelopeSerializer,
    502: ErrorEnvelopeSerializer,
    503: ErrorEnvelopeSerializer,
    504: ErrorEnvelopeSerializer,
}


class WorktreeChangesViewSet(viewsets.GenericViewSet):
    """Read a task worktree's change set and one file's working-tree diff."""

    serializer_class = WorktreeChangesSerializer

    @extend_schema(
        operation_id="source_control_worktree_changes_retrieve",
        tags=["source-control"],
        parameters=[WorktreeChangesQuerySerializer],
        responses=_CHANGES_RESPONSES,
    )
    @action(detail=False, methods=["get"])
    def changes(self, request):
        query = WorktreeChangesQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = source_control.get_worktree_changes(**query.validated_data)
        return Response(WorktreeChangesSerializer(result).data)

    @extend_schema(
        operation_id="source_control_worktree_file_diff_retrieve",
        tags=["source-control"],
        parameters=[FileDiffQuerySerializer],
        responses=_FILE_DIFF_RESPONSES,
    )
    @action(detail=False, methods=["get"])
    def file_diff(self, request):
        query = FileDiffQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = source_control.get_worktree_file_diff(**query.validated_data)
        return Response(FileDiffSerializer(result).data)


class ModuleChangesViewSet(viewsets.GenericViewSet):
    """Read a module base checkout's change set and one file's diff."""

    serializer_class = WorktreeChangesSerializer

    @extend_schema(
        operation_id="source_control_module_changes_retrieve",
        tags=["source-control"],
        parameters=[ModuleChangesQuerySerializer],
        responses=_CHANGES_RESPONSES,
    )
    @action(detail=False, methods=["get"])
    def changes(self, request):
        query = ModuleChangesQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = source_control.get_module_changes(**query.validated_data)
        return Response(WorktreeChangesSerializer(result).data)

    @extend_schema(
        operation_id="source_control_module_file_diff_retrieve",
        tags=["source-control"],
        parameters=[ModuleFileDiffQuerySerializer],
        responses=_FILE_DIFF_RESPONSES,
    )
    @action(detail=False, methods=["get"])
    def file_diff(self, request):
        query = ModuleFileDiffQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = source_control.get_module_file_diff(**query.validated_data)
        return Response(FileDiffSerializer(result).data)
