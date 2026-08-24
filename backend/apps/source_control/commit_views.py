"""DRF ViewSets for committing a checkout's changes.

A task worktree and a module base checkout get their own action rather than one
action with a mode flag, the same way the review reads do: which checkout is
written is then fixed by the route.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.rest_serializers import ErrorEnvelopeSerializer
from apps.source_control.commit import (
    commit_module_changes,
    commit_worktree_changes,
)
from apps.source_control.commit_serializers import (
    ModuleCommitRequestSerializer,
    WorktreeCommitRequestSerializer,
    WorktreeCommitSerializer,
)
from apps.source_control.ship_record_serializers import (
    ShipRecordPersistenceErrorSerializer,
)


class WorktreeCommitViewSet(viewsets.GenericViewSet):
    """Commit everything a task worktree changed, with hooks enabled."""

    serializer_class = WorktreeCommitSerializer

    @extend_schema(
        operation_id="source_control_worktree_commit_create",
        tags=["source-control"],
        request=WorktreeCommitRequestSerializer,
        responses={
            200: WorktreeCommitSerializer,
            # 409 covers both a checkout that cannot be committed from and a
            # commit the repository's own hooks refused.
            409: ErrorEnvelopeSerializer,
            413: ErrorEnvelopeSerializer,
            502: ErrorEnvelopeSerializer,
            503: ErrorEnvelopeSerializer,
            504: ErrorEnvelopeSerializer,
            500: ShipRecordPersistenceErrorSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def commit(self, request):
        body = WorktreeCommitRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_worktree_changes(**body.validated_data)
        return Response(WorktreeCommitSerializer(outcome).data)


class ModuleCommitViewSet(viewsets.GenericViewSet):
    """Commit everything a module base checkout changed, with hooks enabled."""

    serializer_class = WorktreeCommitSerializer

    @extend_schema(
        operation_id="source_control_module_commit_create",
        tags=["source-control"],
        request=ModuleCommitRequestSerializer,
        responses={
            200: WorktreeCommitSerializer,
            409: ErrorEnvelopeSerializer,
            413: ErrorEnvelopeSerializer,
            502: ErrorEnvelopeSerializer,
            503: ErrorEnvelopeSerializer,
            504: ErrorEnvelopeSerializer,
            500: ShipRecordPersistenceErrorSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def commit(self, request):
        body = ModuleCommitRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_module_changes(**body.validated_data)
        return Response(WorktreeCommitSerializer(outcome).data)
