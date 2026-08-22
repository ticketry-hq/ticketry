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
from apps.runs import api as runs
from apps.runs import authorization as run_authorization
from apps.runs.run_scopes import RUN_SCOPES
from apps.settings_store import api as settings
from apps.settings_store.schemas import ProfileBody
from apps.worktrees import api as worktrees


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


class ModuleFolderValidationSerializer(serializers.Serializer):
    path = serializers.CharField()


class ModuleFolderValidationResultSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    reason = serializers.ChoiceField(
        choices=(
            "module_folder_not_absolute",
            "module_folder_missing",
            "module_folder_not_a_directory",
        ),
        allow_null=True,
    )


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


class RunAuthorizationRequestSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()


class RunAuthorizationSerializer(serializers.Serializer):
    authorization = serializers.CharField()


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
    # A shell run has no provider, so the wire carries an explicit null rather
    # than a fabricated slug (#665).
    agent = serializers.CharField(allow_null=True)
    scope = serializers.ChoiceField(choices=RUN_SCOPES)
    # Write-once snapshots of how the run was launched: the workflow state's
    # display name and the model launch configuration actually resolved. Null
    # means "not recorded" — never the work item's current state (#693).
    launch_state = serializers.CharField(allow_null=True)
    launch_model = serializers.CharField(allow_null=True)
    started_at = serializers.CharField()
    state = serializers.CharField()
    updated_at = serializers.CharField()
    # Terminal output activity: ordered by sequence, independent of the
    # lifecycle axis above (#661).
    output_sequence = serializers.IntegerField()
    last_output_at = serializers.CharField(allow_null=True)
    effective_state = serializers.CharField()


class AgentStatusScopeResponseSerializer(serializers.Serializer):
    project_id = serializers.CharField()
    task_id = serializers.CharField(allow_null=True)


class AgentStatusResponseSerializer(serializers.Serializer):
    scope = AgentStatusScopeResponseSerializer()
    runs = AgentRunRecordSerializer(many=True)
    automation_attempts = AutomationAttemptSerializer(many=True)
    at = serializers.CharField()


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


class ModuleFolderValidationView(AuthenticatedAPIView):
    @extend_schema(
        tags=["settings"],
        request=ModuleFolderValidationSerializer,
        responses=ModuleFolderValidationResultSerializer,
    )
    def post(self, request):
        return _serialize_result(
            async_to_sync(settings.validate_folder)(
                _pydantic(settings.ModuleFolderValidationBody, request.data)
            )
        )


class ModuleActivityView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], parameters=[OpenApiParameter("project_id", str, required=True), OpenApiParameter("window_days", int)], responses={200: {"type": "object", "additionalProperties": {"type": "string"}}})
    def get(self, request):
        project_id = request.query_params.get("project_id")
        if not project_id:
            return Response({"detail": {"error": "project_id_required"}}, status=400)
        window_days = int(request.query_params.get("window_days", runs.dao.DEFAULT_ACTIVITY_WINDOW_DAYS))
        return _serialize_result(async_to_sync(runs.get_module_activity)(project_id, window_days))


class RunAuthorizationView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], request=RunAuthorizationRequestSerializer, responses=RunAuthorizationSerializer)
    def post(self, request):
        body = RunAuthorizationRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response({"authorization": run_authorization.issue(body.validated_data["agent_run_id"])})


class RunPrincipalView(AuthenticatedAPIView):
    @extend_schema(tags=["runs"], request=None, responses=OpenSerializer)
    def post(self, request):
        return Response(run_authorization.principal(request.headers.get("Authorization")))


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
