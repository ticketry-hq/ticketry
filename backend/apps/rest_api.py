"""Canonical DRF adapters for Ticketry's host-level HTTP resources."""

from __future__ import annotations

from asgiref.sync import async_to_sync
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from pydantic import ValidationError as PydanticValidationError
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.documents import api as documents
from apps.execution import api as execution
from apps.execution.execution_mode import EXECUTION_MODE_CHOICES
from apps.runs import api as runs
from apps.settings_store import api as settings
from apps.settings_store.schemas import ProfileBody
from apps.terminals import api as terminals
from apps.worktrees import api as worktrees
from studio_server.contracts import LifecycleEvent


class OpenSerializer(serializers.Serializer):
    """Named JSON object used where the established payload is intentionally open."""

    value = serializers.JSONField(required=False)


class ErrorEnvelopeSerializer(serializers.Serializer):
    detail = serializers.JSONField()
    code = serializers.CharField(required=False)


class SettingValueSerializer(serializers.Serializer):
    value = serializers.JSONField(allow_null=True)


class GlobalLaunchDefaultSerializer(serializers.Serializer):
    provider = serializers.CharField()
    model = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    reasoning = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class ProviderCatalogSerializer(serializers.Serializer):
    activated_providers = serializers.ListField(child=serializers.CharField())
    global_default = GlobalLaunchDefaultSerializer(required=False, allow_null=True)


class ProviderCatalogEnvelopeSerializer(serializers.Serializer):
    value = ProviderCatalogSerializer()


class ModuleLinkSerializer(serializers.Serializer):
    module_id = serializers.CharField()
    path = serializers.CharField()


class ProfileSerializer(serializers.Serializer):
    name = serializers.CharField()
    workspace_slug = serializers.CharField()
    agent_prompt = serializers.CharField(required=False, allow_null=True)
    agent_prompts = serializers.DictField(required=False)
    module_links = ModuleLinkSerializer(many=True, required=False)
    recent_project_id = serializers.CharField(required=False, allow_null=True)
    recent_module_ids = serializers.DictField(required=False)


class FeaturesSerializer(serializers.Serializer):
    sidebar = serializers.BooleanField()
    projects = serializers.BooleanField()


class ConfigSerializer(serializers.Serializer):
    recent_profile_index = serializers.IntegerField(allow_null=True)
    profiles = ProfileSerializer(many=True)
    features = FeaturesSerializer()


class RecentIndexSerializer(serializers.Serializer):
    recent_profile_index = serializers.IntegerField()


class LifecycleEventSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    agent = serializers.ChoiceField(choices=("claude", "agy", "codex", "gemini"))
    kind = serializers.ChoiceField(
        choices=("session_start", "turn_start", "tool_use", "awaiting_input", "permission_required", "turn_complete", "idle", "error", "session_end")
    )
    ts = serializers.CharField()
    message = serializers.CharField(required=False, allow_null=True)
    source = serializers.ChoiceField(choices=("hook", "inactivity", "transport"), required=False)
    provider_session_id = serializers.CharField(required=False, allow_null=True)


class AutomationAttemptSerializer(serializers.Serializer):
    attempt_id = serializers.CharField()
    root_attempt_id = serializers.CharField()
    retry_of_attempt_id = serializers.CharField(allow_null=True)
    work_item_id = serializers.CharField()
    status = serializers.ChoiceField(choices=("pending", "succeeded", "failed"))
    error = serializers.CharField(allow_null=True)
    failure = serializers.JSONField(allow_null=True)
    retryable = serializers.BooleanField()
    agent_run_id = serializers.CharField(allow_null=True)
    updated_at = serializers.CharField()


class AgentRunRecordSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    project_id = serializers.CharField()
    task_id = serializers.CharField(allow_null=True)
    module_id = serializers.CharField()
    agent = serializers.CharField()
    scope = serializers.ChoiceField(choices=("task", "plan", "instant", "docchat"))
    started_at = serializers.CharField()
    state = serializers.CharField()
    updated_at = serializers.CharField()


class AgentStatusScopeResponseSerializer(serializers.Serializer):
    project_id = serializers.CharField()
    task_id = serializers.CharField(allow_null=True)


class AgentStatusResponseSerializer(serializers.Serializer):
    scope = AgentStatusScopeResponseSerializer()
    runs = AgentRunRecordSerializer(many=True)
    automation_attempts = AutomationAttemptSerializer(many=True)
    at = serializers.CharField()


class LifecycleAcceptedSerializer(serializers.Serializer):
    accepted = LifecycleEventSerializer()
    received_at = serializers.CharField()


class ViewerLeaseSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    viewer_id = serializers.CharField()
    transport = serializers.ChoiceField(choices=("browser", "desktop"))


class ViewerLeaseReleaseSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    viewer_id = serializers.CharField()


class ReplacedViewerSerializer(serializers.Serializer):
    viewer_id = serializers.CharField()
    transport = serializers.CharField()


class ViewerLeaseResultSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    viewer_id = serializers.CharField()
    transport = serializers.CharField()
    expires_at = serializers.CharField()
    replaced = ReplacedViewerSerializer(allow_null=True)


class ReleaseResultSerializer(serializers.Serializer):
    released = serializers.BooleanField()


class AgentRunIdSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()


class ResumeResultSerializer(AgentRunIdSerializer):
    resumed_from = serializers.CharField()


class TerminateResultSerializer(AgentRunIdSerializer):
    terminated = serializers.BooleanField()


class SelfTerminateResultSerializer(TerminateResultSerializer):
    ok = serializers.BooleanField()
    already_terminated = serializers.BooleanField()


class CreateTerminalSerializer(serializers.Serializer):
    agent = serializers.CharField()
    project_id = serializers.CharField()
    module_id = serializers.CharField()
    task_id = serializers.CharField(required=False, allow_null=True)
    initial_prompt = serializers.CharField(required=False, allow_null=True)
    is_planning = serializers.BooleanField(required=False)
    is_instant = serializers.BooleanField(required=False)
    instant_prompt = serializers.CharField(required=False, allow_null=True)
    is_doc_chat = serializers.BooleanField(required=False)
    doc_rel_path = serializers.CharField(required=False, allow_null=True)
    doc_id = serializers.CharField(required=False, allow_null=True)


class TerminalRunSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    doc_rel_path = serializers.CharField(required=False, allow_null=True)
    created_at = serializers.CharField(required=False)


class ResumableTerminalSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    agent = serializers.CharField()
    status = serializers.CharField()
    started_at = serializers.CharField()
    provider_session_id = serializers.CharField()
    resumed_from = serializers.CharField(allow_null=True)


class SaveDocumentSerializer(serializers.Serializer):
    content = serializers.CharField()
    digest = serializers.CharField()


class DocumentSerializer(serializers.Serializer):
    id = serializers.CharField()
    rel_path = serializers.CharField()
    root_dir = serializers.CharField(required=False)
    title = serializers.CharField(required=False, allow_null=True)
    kind = serializers.CharField(required=False)
    scope = serializers.CharField(required=False)
    module_id = serializers.CharField(required=False)
    task_id = serializers.CharField(required=False)


class DocumentListSerializer(serializers.Serializer):
    documents = DocumentSerializer(many=True)


class FsEntriesSerializer(serializers.Serializer):
    entries = serializers.ListField(child=serializers.CharField())


class DigestSerializer(serializers.Serializer):
    digest = serializers.CharField()


class WorktreeStatusSerializer(serializers.Serializer):
    kind = serializers.CharField()
    task_id = serializers.CharField()
    top_level_task_id = serializers.CharField()
    is_shared = serializers.BooleanField()
    branch = serializers.CharField(required=False, allow_null=True)
    base_branch = serializers.CharField(required=False, allow_null=True)
    path = serializers.CharField(required=False, allow_null=True)
    state = serializers.CharField(required=False, allow_null=True)
    clean = serializers.BooleanField(required=False, allow_null=True)
    dirty = serializers.BooleanField(required=False, allow_null=True)
    ahead = serializers.IntegerField(required=False, allow_null=True)
    behind = serializers.IntegerField(required=False, allow_null=True)
    conflict = serializers.BooleanField(required=False, allow_null=True)
    ephemeral = serializers.BooleanField(required=False)
    reason = serializers.CharField(required=False, allow_null=True)


class CreateWorktreeSerializer(serializers.Serializer):
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)
    project_id = serializers.CharField(required=False, allow_null=True)
    ticket_seq = serializers.IntegerField(required=False, allow_null=True)
    task_name = serializers.CharField(required=False, allow_null=True)


class DiscardSerializer(serializers.Serializer):
    removed = serializers.BooleanField()
    reason = serializers.CharField()


class AgentOverrideSerializer(serializers.Serializer):
    agent = serializers.CharField(required=False)


class GraphRunRequestSerializer(serializers.Serializer):
    """Graph-run create body: provider override plus execution mode."""

    agent = serializers.CharField(required=False)
    mode = serializers.ChoiceField(choices=EXECUTION_MODE_CHOICES, required=False)


class GraphNodeSerializer(serializers.Serializer):
    id = serializers.CharField()
    state = serializers.CharField()
    parent_id = serializers.CharField(allow_null=True)
    blocked_by = serializers.ListField(child=serializers.CharField())


class GraphSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    nodes = GraphNodeSerializer(many=True)


class GraphRunResultSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    launched = serializers.ListField(child=serializers.CharField())


class GraphResetResultSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    cleared = serializers.ListField(child=serializers.CharField())


class LaunchedAgentResponseSerializer(serializers.Serializer):
    target_id = serializers.CharField()
    agent = serializers.CharField()
    agent_run_id = serializers.CharField()


def _serialize_result(result):
    response_status = status.HTTP_200_OK
    if isinstance(result, tuple):
        response_status, result = result
    if hasattr(result, "model_dump"):
        result = result.model_dump(mode="json")
    return Response(result, status=response_status)


class UnprocessableEntity(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "invalid_request"


def _pydantic(model, data):
    try:
        return model.model_validate(data)
    except PydanticValidationError as exc:
        raise UnprocessableEntity(exc.errors()) from exc


class PublicAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class AuthenticatedAPIView(APIView):
    permission_classes = [IsAuthenticated]


class HealthView(PublicAPIView):
    @extend_schema(tags=["system"], responses={200: inline_serializer("Health", {"ok": serializers.BooleanField()})})
    def get(self, request):
        return Response({"ok": True})


class KeybindingsView(AuthenticatedAPIView):
    @extend_schema(tags=["settings"], responses=SettingValueSerializer)
    def get(self, request):
        return _serialize_result(async_to_sync(settings.get_keybindings)())

    @extend_schema(tags=["settings"], request=SettingValueSerializer, responses=SettingValueSerializer)
    def put(self, request):
        body = _pydantic(settings.SettingValueBody, request.data)
        return _serialize_result(async_to_sync(settings.put_keybindings)(body))


class ProviderCatalogView(AuthenticatedAPIView):
    @extend_schema(tags=["settings"], responses=ProviderCatalogEnvelopeSerializer)
    def get(self, request):
        return _serialize_result(async_to_sync(settings.get_provider_catalog)())

    @extend_schema(tags=["settings"], request=ProviderCatalogEnvelopeSerializer, responses={200: ProviderCatalogEnvelopeSerializer, 422: OpenSerializer})
    def put(self, request):
        body = _pydantic(settings.ProviderCatalogBody, request.data)
        return _serialize_result(async_to_sync(settings.put_provider_catalog)(body))


class ConfigView(AuthenticatedAPIView):
    @extend_schema(tags=["configuration"], responses=ConfigSerializer)
    def get(self, request):
        return _serialize_result(async_to_sync(settings.get_config)())

    @extend_schema(tags=["configuration"], request=RecentIndexSerializer, responses={200: ConfigSerializer, 400: ErrorEnvelopeSerializer})
    def patch(self, request):
        body = _pydantic(settings.RecentIndexBody, request.data)
        return _serialize_result(async_to_sync(settings.patch_config)(body))


class ProfileCollectionView(AuthenticatedAPIView):
    @extend_schema(tags=["configuration"], request=ProfileSerializer, responses=ConfigSerializer)
    def post(self, request):
        return _serialize_result(async_to_sync(settings.add_profile)(_pydantic(ProfileBody, request.data)))


class ProfileDetailView(AuthenticatedAPIView):
    @extend_schema(tags=["configuration"], request=ProfileSerializer, responses={200: ConfigSerializer, 400: ErrorEnvelopeSerializer})
    def put(self, request, index):
        return _serialize_result(async_to_sync(settings.replace_profile)(index, _pydantic(ProfileBody, request.data)))

    @extend_schema(tags=["configuration"], responses={200: ConfigSerializer, 400: ErrorEnvelopeSerializer})
    def delete(self, request, index):
        return _serialize_result(async_to_sync(settings.delete_profile)(index))


class AutomationRetryView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], request=None, responses={200: AutomationAttemptSerializer, 404: OpenSerializer, 409: OpenSerializer})
    def post(self, request, attempt_id):
        return _serialize_result(runs.retry_automation_attempt(attempt_id))


class LifecycleEventView(PublicAPIView):
    @extend_schema(tags=["runs"], request=LifecycleEventSerializer, responses={202: LifecycleAcceptedSerializer})
    def post(self, request):
        event = _pydantic(LifecycleEvent, request.data)
        return _serialize_result(async_to_sync(runs.ingest_lifecycle_event)(event))


class ModuleActivityView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], parameters=[OpenApiParameter("project_id", str, required=True), OpenApiParameter("window_days", int)], responses={200: {"type": "object", "additionalProperties": {"type": "string"}}})
    def get(self, request):
        project_id = request.query_params.get("project_id")
        if not project_id:
            return Response({"detail": {"error": "project_id_required"}}, status=400)
        window_days = int(request.query_params.get("window_days", runs.dao.DEFAULT_ACTIVITY_WINDOW_DAYS))
        return _serialize_result(async_to_sync(runs.get_module_activity)(project_id, window_days))


class AgentStatusView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], parameters=[OpenApiParameter("project_id", str, required=True), OpenApiParameter("task_id", str)], responses=AgentStatusResponseSerializer)
    def get(self, request):
        project_id = request.query_params.get("project_id")
        if not project_id:
            return Response({"detail": {"error": "project_id_required"}}, status=400)
        return _serialize_result(async_to_sync(runs.agent_status)(project_id, request.query_params.get("task_id")))


class ViewerLeaseView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], request=ViewerLeaseSerializer, responses={200: ViewerLeaseResultSerializer, 400: ErrorEnvelopeSerializer, 404: ErrorEnvelopeSerializer})
    def post(self, request):
        return _serialize_result(terminals.acquire_viewer_lease(_pydantic(terminals.ViewerLeaseBody, request.data)))


class ViewerLeaseRenewView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], request=ViewerLeaseReleaseSerializer, responses={200: ViewerLeaseResultSerializer, 409: ErrorEnvelopeSerializer})
    def post(self, request):
        return _serialize_result(terminals.renew_viewer_lease(_pydantic(terminals.ViewerLeaseReleaseBody, request.data)))


class ViewerLeaseReleaseView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], request=ViewerLeaseReleaseSerializer, responses=ReleaseResultSerializer)
    def post(self, request):
        return _serialize_result(terminals.release_viewer_lease(_pydantic(terminals.ViewerLeaseReleaseBody, request.data)))


class TerminalCollectionView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], parameters=[OpenApiParameter("task_id", str, required=True)], responses=TerminalRunSerializer(many=True))
    def get(self, request):
        task_id = request.query_params.get("task_id")
        if not task_id:
            return Response({"detail": {"error": "task_id_required"}}, status=400)
        return _serialize_result(terminals.list_terminals(task_id))

    @extend_schema(tags=["terminals"], request=CreateTerminalSerializer, responses={200: AgentRunIdSerializer, 400: ErrorEnvelopeSerializer, 500: ErrorEnvelopeSerializer})
    def post(self, request):
        return _serialize_result(terminals.create_terminal(_pydantic(terminals.CreateTerminalRunBody, request.data)))

    @extend_schema(tags=["terminals"], parameters=[OpenApiParameter("agent_run_id", str, required=True)], responses={200: TerminateResultSerializer, 404: ErrorEnvelopeSerializer, 500: ErrorEnvelopeSerializer})
    def delete(self, request):
        agent_run_id = request.query_params.get("agent_run_id")
        if not agent_run_id:
            return Response({"detail": {"error": "agent_run_id_required"}}, status=400)
        return _serialize_result(terminals.terminate_terminal(agent_run_id))


class TerminalResumeView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], parameters=[OpenApiParameter("agent_run_id", str, required=True)], request=None, responses={200: ResumeResultSerializer, 404: ErrorEnvelopeSerializer, 409: ErrorEnvelopeSerializer, 500: ErrorEnvelopeSerializer})
    def post(self, request):
        agent_run_id = request.query_params.get("agent_run_id")
        if not agent_run_id:
            return Response({"detail": {"error": "agent_run_id_required"}}, status=400)
        return _serialize_result(terminals.resume_terminal(agent_run_id))


class ResumableTerminalsView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], parameters=[OpenApiParameter("task_id", str), OpenApiParameter("project_id", str), OpenApiParameter("module_id", str)], responses=ResumableTerminalSerializer(many=True))
    def get(self, request):
        return _serialize_result(terminals.list_resumable_terminals(request.query_params.get("task_id"), request.query_params.get("project_id"), request.query_params.get("module_id")))


class ScratchTerminalsView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], parameters=[OpenApiParameter("project_id", str, required=True), OpenApiParameter("module_id", str)], responses=TerminalRunSerializer(many=True))
    def get(self, request):
        project_id = request.query_params.get("project_id")
        if not project_id:
            return Response({"detail": {"error": "project_id_required"}}, status=400)
        return _serialize_result(terminals.list_scratch_terminals(project_id, request.query_params.get("module_id")))


class SelfTerminateView(PublicAPIView):
    @extend_schema(tags=["terminals"], request=None, responses={200: SelfTerminateResultSerializer, 401: OpenSerializer, 404: OpenSerializer, 500: OpenSerializer})
    def post(self, request):
        return _serialize_result(
            terminals.self_terminate_terminal(request.headers.get("Authorization"))
        )


class McpRunAuthorizationView(AuthenticatedAPIView):
    @extend_schema(tags=["terminals"], request=None, responses={200: OpenSerializer, 401: OpenSerializer, 404: OpenSerializer})
    def post(self, request):
        return _serialize_result(
            terminals.authorize_mcp_run(request.headers.get("Authorization"))
        )


class DocumentsView(AuthenticatedAPIView):
    @extend_schema(tags=["documents"], parameters=[OpenApiParameter("task_id", str), OpenApiParameter("scope", str), OpenApiParameter("project_id", str), OpenApiParameter("module_id", str), OpenApiParameter("profile", int)], responses={200: DocumentListSerializer, 400: ErrorEnvelopeSerializer})
    def get(self, request):
        q = request.query_params
        profile = int(q["profile"]) if "profile" in q else None
        return _serialize_result(async_to_sync(documents.list_documents)(q.get("task_id"), q.get("scope"), q.get("project_id"), q.get("module_id"), profile))


class DocumentAssetView(PublicAPIView):
    @extend_schema(tags=["documents"], responses={(200, "application/octet-stream"): OpenApiTypes.BINARY, 404: ErrorEnvelopeSerializer})
    def get(self, request, doc_id, asset_path):
        asset = async_to_sync(documents.read_document_asset)(doc_id, asset_path)
        response = HttpResponse(asset.content, content_type=asset.media_type)
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        if asset.etag is not None:
            response["ETag"] = f'"{asset.etag}"'
        return response


class DocumentSaveView(AuthenticatedAPIView):
    @extend_schema(tags=["documents"], request=SaveDocumentSerializer, responses={200: DigestSerializer, 404: ErrorEnvelopeSerializer, 409: ErrorEnvelopeSerializer})
    def put(self, request, doc_id):
        saved = async_to_sync(documents.save_document)(
            doc_id, _pydantic(documents.SaveDocumentIn, request.data)
        )
        if saved.conflict:
            payload = {
                "detail": "conflict",
                "code": "conflict",
                "digest": saved.digest,
            }
            response_status = status.HTTP_409_CONFLICT
        else:
            payload = {"digest": saved.digest}
            response_status = status.HTTP_200_OK
        return Response(
            payload,
            status=response_status,
            headers={"ETag": f'"{saved.digest}"'},
        )


class FsCompleteView(AuthenticatedAPIView):
    @extend_schema(tags=["documents"], parameters=[OpenApiParameter("path", str)], responses=FsEntriesSerializer)
    def get(self, request):
        return _serialize_result(async_to_sync(documents.fs_complete)(request.query_params.get("path", "")))


class WorktreeView(AuthenticatedAPIView):
    @extend_schema(tags=["worktrees"], parameters=[OpenApiParameter("task_id", str, required=True), OpenApiParameter("parent_id", str), OpenApiParameter("module_id", str)], responses=WorktreeStatusSerializer)
    def get(self, request):
        q = request.query_params
        if not q.get("task_id"):
            return Response({"detail": {"error": "task_id_required"}}, status=400)
        return _serialize_result(worktrees.get_worktree(q["task_id"], q.get("parent_id"), q.get("module_id")))


class WorktreeCreateView(AuthenticatedAPIView):
    @extend_schema(tags=["worktrees"], request=CreateWorktreeSerializer, responses=WorktreeStatusSerializer)
    def post(self, request, task_id):
        return _serialize_result(worktrees.create_worktree(task_id, _pydantic(worktrees.CreateWorktreeIn, request.data)))


class WorktreeDiscardView(AuthenticatedAPIView):
    @extend_schema(tags=["worktrees"], parameters=[OpenApiParameter("parent_id", str), OpenApiParameter("module_id", str)], request=None, responses=DiscardSerializer)
    def post(self, request, task_id):
        return _serialize_result(worktrees.discard_worktree(task_id, request.query_params.get("parent_id"), request.query_params.get("module_id")))


class GraphRunView(AuthenticatedAPIView):
    @extend_schema(operation_id="workItemsGraphRunRetrieve", tags=["execution"], responses={200: GraphSerializer, 404: ErrorEnvelopeSerializer})
    def get(self, request, issue_id):
        return _serialize_result(execution.get_dependency_graph(issue_id))

    @extend_schema(operation_id="workItemsGraphRunCreate", tags=["execution"], request=GraphRunRequestSerializer, responses={201: GraphRunResultSerializer, 404: ErrorEnvelopeSerializer, 409: ErrorEnvelopeSerializer, 422: ErrorEnvelopeSerializer})
    def post(self, request, issue_id):
        return _serialize_result(execution.create_execute_graph(issue_id, _pydantic(execution.ExecuteGraphIn, request.data)))

    @extend_schema(operation_id="workItemsGraphRunDestroy", tags=["execution"], responses={200: GraphResetResultSerializer, 404: ErrorEnvelopeSerializer})
    def delete(self, request, issue_id):
        return _serialize_result(execution.reset_execute_graph(issue_id))


class LaunchAgentView(AuthenticatedAPIView):
    @extend_schema(operation_id="workItemsLaunchAgentCreate", tags=["execution"], request=AgentOverrideSerializer, responses={201: LaunchedAgentResponseSerializer, 400: ErrorEnvelopeSerializer, 404: ErrorEnvelopeSerializer, 422: ErrorEnvelopeSerializer, 503: ErrorEnvelopeSerializer})
    def post(self, request, issue_id):
        return _serialize_result(execution.create_launch_agent(issue_id, _pydantic(execution.LaunchAgentIn, request.data)))


class RunsEffectReadinessView(AuthenticatedAPIView):
    """The health record Rust requires before it will call this executor."""

    @extend_schema(
        operation_id="runsEffectPortReadiness",
        tags=["terminals"],
        responses={200: OpenSerializer},
    )
    def get(self, request):
        from apps.terminals import runs_effect_port

        readiness = runs_effect_port.readiness()
        return Response(readiness, status=200 if readiness["ready"] else 503)


class RunsEffectObserveView(AuthenticatedAPIView):
    """Report what exists under one deterministic runtime identity."""

    @extend_schema(
        operation_id="runsEffectPortObserve",
        tags=["terminals"],
        request=OpenSerializer,
        responses={200: OpenSerializer},
    )
    def post(self, request):
        from apps.terminals import runs_effect_port

        return Response(runs_effect_port.observe(request.data or {}), status=200)


class RunsEffectExecuteView(AuthenticatedAPIView):
    """Perform one already-durable launch effect and report a typed outcome."""

    @extend_schema(
        operation_id="runsEffectPortExecute",
        tags=["terminals"],
        request=OpenSerializer,
        responses={200: OpenSerializer},
    )
    def post(self, request):
        from apps.terminals import runs_effect_port

        return Response(runs_effect_port.execute(request.data or {}), status=200)


class LaunchPolicyEffectView(AuthenticatedAPIView):
    @extend_schema(
        operation_id="launchPolicyEffectReadiness",
        tags=["execution"],
        responses={200: OpenSerializer},
    )
    def get(self, request):
        from apps.settings_store.write_ownership import rust_owns_slice2_writes

        ready = rust_owns_slice2_writes()
        return Response(
            {
                "version": 1,
                "ready": ready,
                "policy_owner": "rust",
                "effect_owner": "django",
                "django_write_fallback": False,
            },
            status=200 if ready else 503,
        )

    @extend_schema(
        operation_id="launchPolicyEffectCreate",
        tags=["execution"],
        request=OpenSerializer,
        responses={200: OpenSerializer, 201: OpenSerializer},
    )
    def post(self, request):
        from apps.settings_store.write_ownership import (
            rust_owns_slice2_writes,
            slice2_commands_ready,
        )

        if rust_owns_slice2_writes() and not slice2_commands_ready():
            return Response(
                {
                    "detail": "Slice 2 is not ready; launch commands are disabled",
                    "code": "slice2_not_ready",
                },
                status=503,
            )
        decision = _pydantic(execution.LaunchPolicyDecisionIn, request.data)
        return _serialize_result(execution.perform(decision))
