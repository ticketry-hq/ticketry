"""DRF ViewSet for the pull-request actions on a task worktree.

Two actions on one ViewSet because they are two lengths of the same stack: the
whole thing, and the last step on its own for the retry after a provider
failure. Sharing the ViewSet means they share one request shape, one resolution
path, and one response shape — a client that renders the full stack renders the
retry without learning anything new.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.rest_serializers import ErrorEnvelopeSerializer
from apps.source_control.pull_request_action import (
    commit_push_and_open_pull_request_for_module,
    commit_push_and_open_pull_request_for_task,
    open_pull_request_for_module,
    open_pull_request_for_task,
)
from apps.source_control.pull_request_serializers import (
    ModulePullRequestRequestSerializer,
    WorktreePullRequestRequestSerializer,
    WorktreePullRequestSerializer,
)


_ACTION_FAILURE_RESPONSES = {
    # 409 covers every precondition the user resolves themselves: a checkout
    # with nothing to commit from, a commit the repository's hooks refused, the
    # push preconditions, the default branch, a dirty tree, and a ``gh`` that
    # is installed but not logged in.
    409: ErrorEnvelopeSerializer,
    413: ErrorEnvelopeSerializer,
    # 502 is git or GitHub refusing; 503 is git or ``gh`` not being installed.
    502: ErrorEnvelopeSerializer,
    503: ErrorEnvelopeSerializer,
    504: ErrorEnvelopeSerializer,
}


class WorktreePullRequestViewSet(viewsets.GenericViewSet):
    """Open a GitHub pull request for a task worktree, through the user's ``gh``."""

    serializer_class = WorktreePullRequestSerializer

    @extend_schema(
        operation_id="source_control_worktree_commit_push_pr_create",
        tags=["source-control"],
        request=WorktreePullRequestRequestSerializer,
        responses={
            200: WorktreePullRequestSerializer,
            **_ACTION_FAILURE_RESPONSES,
        },
    )
    @action(detail=False, methods=["post"])
    def commit_push_pr(self, request):
        body = WorktreePullRequestRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_push_and_open_pull_request_for_task(**body.validated_data)
        return Response(WorktreePullRequestSerializer(outcome).data)

    @extend_schema(
        operation_id="source_control_worktree_pull_request_create",
        tags=["source-control"],
        request=WorktreePullRequestRequestSerializer,
        responses={
            200: WorktreePullRequestSerializer,
            **_ACTION_FAILURE_RESPONSES,
        },
    )
    @action(detail=False, methods=["post"])
    def pull_request(self, request):
        body = WorktreePullRequestRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = open_pull_request_for_task(**body.validated_data)
        return Response(WorktreePullRequestSerializer(outcome).data)


class ModulePullRequestViewSet(viewsets.GenericViewSet):
    """Open a GitHub pull request for a module base checkout.

    Offered for the case that makes it meaningful — a base checkout sitting on
    a feature branch. On the default branch the pull request's own precondition
    refuses the action before it writes anything, which is why the module
    surface offers this action without making it the primary one.
    """

    serializer_class = WorktreePullRequestSerializer

    @extend_schema(
        operation_id="source_control_module_commit_push_pr_create",
        tags=["source-control"],
        request=ModulePullRequestRequestSerializer,
        responses={
            200: WorktreePullRequestSerializer,
            **_ACTION_FAILURE_RESPONSES,
        },
    )
    @action(detail=False, methods=["post"])
    def commit_push_pr(self, request):
        body = ModulePullRequestRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = commit_push_and_open_pull_request_for_module(
            **body.validated_data
        )
        return Response(WorktreePullRequestSerializer(outcome).data)

    @extend_schema(
        operation_id="source_control_module_pull_request_create",
        tags=["source-control"],
        request=ModulePullRequestRequestSerializer,
        responses={
            200: WorktreePullRequestSerializer,
            **_ACTION_FAILURE_RESPONSES,
        },
    )
    @action(detail=False, methods=["post"])
    def pull_request(self, request):
        body = ModulePullRequestRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = open_pull_request_for_module(**body.validated_data)
        return Response(WorktreePullRequestSerializer(outcome).data)
