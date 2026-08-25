"""DRF ViewSet for the commit-and-push action and its confirmation.

The confirmation read lives on the same ViewSet as the action it guards, so
the two can never disagree about which checkout they are talking about: one
request shape, one resolution path, one place to look.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.rest_serializers import ErrorEnvelopeSerializer
from apps.source_control.push_preview import (
    preview_module_push,
    preview_worktree_push,
)
from apps.source_control.push_serializers import (
    ModuleActionRequestSerializer,
    ModulePushPreviewQuerySerializer,
    WorktreeActionRequestSerializer,
    WorktreeCommitPushSerializer,
    WorktreePushPreviewQuerySerializer,
    WorktreePushPreviewSerializer,
)
from apps.source_control.stacked_action import (
    commit_and_push_module,
    commit_and_push_worktree,
)


_GIT_FAILURE_RESPONSES = {
    # 409 covers a checkout with nothing to commit from, a commit the
    # repository's hooks refused, and every push precondition the user has to
    # resolve in a terminal.
    409: ErrorEnvelopeSerializer,
    413: ErrorEnvelopeSerializer,
    502: ErrorEnvelopeSerializer,
    503: ErrorEnvelopeSerializer,
    504: ErrorEnvelopeSerializer,
}


class WorktreePushViewSet(viewsets.GenericViewSet):
    """Publish a task worktree's branch, and describe the push beforehand."""

    serializer_class = WorktreeCommitPushSerializer

    @extend_schema(
        operation_id="source_control_worktree_push_preview_retrieve",
        tags=["source-control"],
        parameters=[WorktreePushPreviewQuerySerializer],
        responses={200: WorktreePushPreviewSerializer, **_GIT_FAILURE_RESPONSES},
    )
    @action(detail=False, methods=["get"])
    def push_preview(self, request):
        query = WorktreePushPreviewQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = preview_worktree_push(**query.validated_data)
        return Response(WorktreePushPreviewSerializer(result).data)

    @extend_schema(
        operation_id="source_control_worktree_commit_push_create",
        tags=["source-control"],
        request=WorktreeActionRequestSerializer,
        responses={200: WorktreeCommitPushSerializer, **_GIT_FAILURE_RESPONSES},
    )
    @action(detail=False, methods=["post"])
    def commit_push(self, request):
        body = WorktreeActionRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_and_push_worktree(**body.validated_data)
        return Response(WorktreeCommitPushSerializer(outcome).data)


class ModulePushViewSet(viewsets.GenericViewSet):
    """Publish a module base checkout's branch, and describe the push first.

    The module checkout's terminal action (ADR 0013): a base checkout normally
    sits on the default branch, where a pull request is refused, so committing
    and publishing is the whole flow rather than a stop on the way to one.
    """

    serializer_class = WorktreeCommitPushSerializer

    @extend_schema(
        operation_id="source_control_module_push_preview_retrieve",
        tags=["source-control"],
        parameters=[ModulePushPreviewQuerySerializer],
        responses={200: WorktreePushPreviewSerializer, **_GIT_FAILURE_RESPONSES},
    )
    @action(detail=False, methods=["get"])
    def push_preview(self, request):
        query = ModulePushPreviewQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = preview_module_push(**query.validated_data)
        return Response(WorktreePushPreviewSerializer(result).data)

    @extend_schema(
        operation_id="source_control_module_commit_push_create",
        tags=["source-control"],
        request=ModuleActionRequestSerializer,
        responses={200: WorktreeCommitPushSerializer, **_GIT_FAILURE_RESPONSES},
    )
    @action(detail=False, methods=["post"])
    def commit_push(self, request):
        body = ModuleActionRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_and_push_module(**body.validated_data)
        return Response(WorktreeCommitPushSerializer(outcome).data)
