"""Quarantined graph-run operations exposed through DRF actions."""

from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.execution import api as execution
from apps.execution.rest_serializers import (
    AgentOverrideSerializer,
    LaunchedAgentResponseSerializer,
    RunNowRefusalSerializer,
    RunNowRequestSerializer,
    RunNowResponseSerializer,
    GraphResetResultSerializer,
    GraphRunRequestSerializer,
    GraphRunResultSerializer,
    GraphSerializer,
)
from apps.rest_serializers import ErrorEnvelopeSerializer


class GraphRunDomainActionMixin:
    """Read, arm, advance, and reset a work-item subtree campaign."""

    @extend_schema(
        operation_id="workItemsGraphRunRetrieve",
        tags=["execution"],
        responses={200: GraphSerializer, 404: ErrorEnvelopeSerializer},
    )
    @action(detail=True, methods=["get"])
    def retrieve_graph(self, request, issue_id=None):
        response_status, result = execution.get_dependency_graph(issue_id)
        return Response(GraphSerializer(result).data, status=response_status)

    @extend_schema(
        operation_id="workItemsGraphRunCreate",
        tags=["execution"],
        request=GraphRunRequestSerializer,
        responses={
            201: GraphRunResultSerializer,
            404: ErrorEnvelopeSerializer,
            409: ErrorEnvelopeSerializer,
            422: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=True, methods=["post"])
    def create_graph(self, request, issue_id=None):
        serializer = GraphRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        response_status, result = execution.create_execute_graph(
            issue_id,
            **serializer.validated_data,
        )
        return Response(GraphRunResultSerializer(result).data, status=response_status)

    @extend_schema(
        operation_id="workItemsGraphRunDestroy",
        tags=["execution"],
        request=None,
        responses={200: GraphResetResultSerializer, 404: ErrorEnvelopeSerializer},
    )
    @action(detail=True, methods=["delete"])
    def reset_graph(self, request, issue_id=None):
        response_status, result = execution.reset_execute_graph(issue_id)
        return Response(GraphResetResultSerializer(result).data, status=response_status)


class WorkItemExecutionDomainActionMixin:
    """Commands that compose workflow mutation with task execution."""

    @extend_schema(
        operation_id="workItemsLaunchAgentCreate",
        tags=["execution"],
        request=AgentOverrideSerializer,
        responses={
            201: LaunchedAgentResponseSerializer,
            400: ErrorEnvelopeSerializer,
            404: ErrorEnvelopeSerializer,
            409: ErrorEnvelopeSerializer,
            422: ErrorEnvelopeSerializer,
            503: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=True, methods=["post"])
    def launch_agent(self, request, issue_id=None):
        serializer = AgentOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        response_status, result = execution.create_launch_agent(
            issue_id,
            **serializer.validated_data,
        )
        return Response(
            LaunchedAgentResponseSerializer(result).data,
            status=response_status,
        )

    @extend_schema(
        operation_id="workItemsRunNowCreate",
        tags=["execution"],
        auth=[{"ApiKeyAuth": []}],
        request=RunNowRequestSerializer,
        responses={
            201: RunNowResponseSerializer,
            400: RunNowRefusalSerializer,
            404: RunNowRefusalSerializer,
            409: RunNowRefusalSerializer,
            422: RunNowRefusalSerializer,
            503: RunNowRefusalSerializer,
        },
    )
    @action(detail=True, methods=["post"])
    def run_now(self, request, issue_id=None):
        serializer = RunNowRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        caller_agent_run_id = getattr(
            request.auth,
            "caller_agent_run_id",
            None,
        )
        response_status, result = execution.create_run_now(
            issue_id,
            origin=serializer.validated_data["origin"],
            caller_agent_run_id=caller_agent_run_id,
        )
        return Response(
            RunNowResponseSerializer(result).data,
            status=response_status,
        )
