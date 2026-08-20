"""Quarantined terminal domain operations exposed through DRF actions."""

from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.rest_serializers import ErrorEnvelopeSerializer, OpenSerializer
from apps.terminals import api as terminals
from apps.terminals import shell_api as terminal_shells
from apps.terminals.rest_authentication import RunScopedAuthentication
from apps.terminals.rest_serializers import (
    AgentRunIdSerializer,
    CreateModuleShellSerializer,
    CreateTerminalSerializer,
    ModuleShellQuerySerializer,
    ModuleShellSerializer,
    ReleaseResultSerializer,
    ResumableTerminalQuerySerializer,
    ResumableTerminalSerializer,
    ResumeResultSerializer,
    ScratchTerminalQuerySerializer,
    SelfTerminateResultSerializer,
    TerminalIdentityQuerySerializer,
    TerminalListQuerySerializer,
    TerminalRunSerializer,
    TerminateResultSerializer,
    ViewerLeaseIdentitySerializer,
    ViewerLeaseRequestSerializer,
    ViewerLeaseResultSerializer,
    ViewerOutputReportResultSerializer,
    ViewerOutputReportSerializer,
)


class TerminalDomainActionMixin:
    """Expose terminal lifecycle, shell, and viewer commands through DRF."""

    @extend_schema(
        operation_id="terminals_list",
        tags=["terminals"],
        parameters=[TerminalListQuerySerializer],
        responses=TerminalRunSerializer(many=True),
    )
    def list(self, request):
        query = TerminalListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminals.list_terminals(query.validated_data["task_id"])
        return Response(TerminalRunSerializer(result, many=True).data)

    @extend_schema(
        operation_id="terminals_create",
        tags=["terminals"],
        request=CreateTerminalSerializer,
        responses={
            200: AgentRunIdSerializer,
            400: ErrorEnvelopeSerializer,
            409: OpenSerializer,
            500: ErrorEnvelopeSerializer,
        },
    )
    def create(self, request):
        serializer = CreateTerminalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminals.create_terminal(**serializer.validated_data)
        return Response(AgentRunIdSerializer(result).data)

    @extend_schema(
        operation_id="terminals_destroy",
        tags=["terminals"],
        parameters=[TerminalIdentityQuerySerializer],
        request=None,
        responses={
            200: TerminateResultSerializer,
            404: ErrorEnvelopeSerializer,
            500: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=False, methods=["delete"])
    def terminate(self, request):
        query = TerminalIdentityQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminals.terminate_terminal(query.validated_data["agent_run_id"])
        return Response(TerminateResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_resume_create",
        tags=["terminals"],
        parameters=[TerminalIdentityQuerySerializer],
        request=None,
        responses={
            200: ResumeResultSerializer,
            404: ErrorEnvelopeSerializer,
            409: ErrorEnvelopeSerializer,
            500: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def resume(self, request):
        query = TerminalIdentityQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminals.resume_terminal(query.validated_data["agent_run_id"])
        return Response(ResumeResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_resumable_list",
        tags=["terminals"],
        parameters=[ResumableTerminalQuerySerializer],
        responses=ResumableTerminalSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def resumable(self, request):
        query = ResumableTerminalQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminals.list_resumable_terminals(**query.validated_data)
        return Response(ResumableTerminalSerializer(result, many=True).data)

    @extend_schema(
        operation_id="terminals_scratch_list",
        tags=["terminals"],
        parameters=[ScratchTerminalQuerySerializer],
        responses=TerminalRunSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def scratch(self, request):
        query = ScratchTerminalQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminals.list_scratch_terminals(**query.validated_data)
        return Response(TerminalRunSerializer(result, many=True).data)

    @extend_schema(
        operation_id="terminals_shells_list",
        tags=["terminals"],
        parameters=[ModuleShellQuerySerializer],
        responses=ModuleShellSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def list_shells(self, request):
        query = ModuleShellQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = terminal_shells.list_module_shells(query.validated_data["module_id"])
        return Response(ModuleShellSerializer(result, many=True).data)

    @extend_schema(
        operation_id="terminals_shells_create",
        tags=["terminals"],
        request=CreateModuleShellSerializer,
        responses={
            200: AgentRunIdSerializer,
            409: ErrorEnvelopeSerializer,
            500: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def create_shell(self, request):
        serializer = CreateModuleShellSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminal_shells.create_module_shell(**serializer.validated_data)
        return Response(AgentRunIdSerializer(result).data)

    @extend_schema(
        operation_id="terminals_viewers_lease_create",
        tags=["terminals"],
        request=ViewerLeaseRequestSerializer,
        responses={
            200: ViewerLeaseResultSerializer,
            400: ErrorEnvelopeSerializer,
            404: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def acquire_viewer_lease(self, request):
        serializer = ViewerLeaseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminals.acquire_viewer_lease(**serializer.validated_data)
        return Response(ViewerLeaseResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_viewers_lease_renew_create",
        tags=["terminals"],
        request=ViewerLeaseIdentitySerializer,
        responses={
            200: ViewerLeaseResultSerializer,
            409: ErrorEnvelopeSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def renew_viewer_lease(self, request):
        serializer = ViewerLeaseIdentitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminals.renew_viewer_lease(**serializer.validated_data)
        return Response(ViewerLeaseResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_viewers_lease_release_create",
        tags=["terminals"],
        request=ViewerLeaseIdentitySerializer,
        responses=ReleaseResultSerializer,
    )
    @action(detail=False, methods=["post"])
    def release_viewer_lease(self, request):
        serializer = ViewerLeaseIdentitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminals.release_viewer_lease(**serializer.validated_data)
        return Response(ReleaseResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_viewers_output_create",
        tags=["terminals"],
        request=ViewerOutputReportSerializer,
        responses=ViewerOutputReportResultSerializer,
    )
    @action(detail=False, methods=["post"])
    def report_viewer_output(self, request):
        serializer = ViewerOutputReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = terminals.report_viewer_output(**serializer.validated_data)
        return Response(ViewerOutputReportResultSerializer(result).data)

    @extend_schema(
        operation_id="terminals_self_terminate_create",
        tags=["terminals"],
        auth=[{}],
        request=None,
        responses={
            200: SelfTerminateResultSerializer,
            401: OpenSerializer,
            404: OpenSerializer,
            500: OpenSerializer,
        },
    )
    @action(
        detail=False,
        methods=["post"],
        authentication_classes=[RunScopedAuthentication],
        permission_classes=[IsAuthenticated],
    )
    def self_terminate(self, request):
        result = terminals.self_terminate_terminal(request.user.agent_run_id)
        return Response(SelfTerminateResultSerializer(result).data)
