"""DRF views introduced during the expand phase."""

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
)
from worktracker.rest.serializers import (
    AgentModelSerializer,
    IssueTypeSerializer,
    IssueTypeTransitionSerializer,
    LaunchBindingSerializer,
    ModuleSerializer,
    ProjectSerializer,
    ProviderSerializer,
    ReasoningLevelSerializer,
    StateSerializer,
    WorkflowRevisionSerializer,
    WorkspaceSerializer,
)
from worktracker.services import scoped_workflows, workflow_config
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError
from worktracker.services.modules import create_module
from worktracker.services.projects import create_project, delete_project, update_project
from worktracker.services.workspaces import get_installation_workspace


@extend_schema_view(get=extend_schema(tags=["Workspace"]))
class WorkspaceRetrieveView(APIView):
    """Retrieve the installation workspace before project selection."""

    @extend_schema(operation_id="retrieveWorkspace", responses=WorkspaceSerializer)
    def get(self, request):
        workspace = get_installation_workspace()
        return Response(WorkspaceSerializer(workspace).data)


@extend_schema_view(
    list=extend_schema(operation_id="listProjects", tags=["Projects"]),
    create=extend_schema(operation_id="createProject", tags=["Projects"]),
    partial_update=extend_schema(operation_id="updateProject", tags=["Projects"]),
    destroy=extend_schema(operation_id="deleteProject", tags=["Projects"]),
)
class ProjectViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Project CRUD with the existing immutable-key service semantics."""

    queryset = Project.objects.order_by("created_at", "id")
    serializer_class = ProjectSerializer
    lookup_url_kwarg = "project_id"

    def perform_create(self, serializer):
        serializer.instance = create_project(**serializer.validated_data)

    def perform_update(self, serializer):
        serializer.instance = update_project(
            self.kwargs["project_id"], **serializer.validated_data
        )

    def perform_destroy(self, instance):
        delete_project(instance.id)


@extend_schema_view(
    list=extend_schema(operation_id="listModules", tags=["Modules"]),
    create=extend_schema(operation_id="createModule", tags=["Modules"]),
)
class ModuleViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Project-scoped module collection with explicit stable ordering."""

    serializer_class = ModuleSerializer

    def get_queryset(self):
        queryset = (
            Issue.objects.filter(project_id=self.kwargs["project_id"], type="module")
            .select_related("project", "issue_type")
            .order_by("sequence_id", "id")
        )
        include_archived = self.request.query_params.get("include_archived", "false")
        if include_archived.casefold() not in {"true", "1"}:
            queryset = queryset.exclude(is_archived=True)
        return queryset

    def perform_create(self, serializer):
        serializer.instance = create_module(
            self.kwargs["project_id"],
            serializer.validated_data["name"],
            serializer.validated_data["issue_type_id"],
        )


class CatalogViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The catalog's list/create/patch/delete contract (no overlapping retrieve)."""

    lookup_url_kwarg = "id"

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ConflictError(
                f"{instance._meta.verbose_name.title()} is still in use."
            ) from exc


@extend_schema_view(
    list=extend_schema(operation_id="listProviders", tags=["Providers"]),
    create=extend_schema(operation_id="createProvider", tags=["Providers"]),
    partial_update=extend_schema(operation_id="updateProvider", tags=["Providers"]),
    destroy=extend_schema(operation_id="deleteProvider", tags=["Providers"]),
)
class ProviderViewSet(CatalogViewSet):
    queryset = Provider.objects.order_by("slug")
    serializer_class = ProviderSerializer


@extend_schema_view(
    list=extend_schema(operation_id="listAgentModels", tags=["Models"]),
    create=extend_schema(operation_id="createAgentModel", tags=["Models"]),
    partial_update=extend_schema(operation_id="updateAgentModel", tags=["Models"]),
    destroy=extend_schema(operation_id="deleteAgentModel", tags=["Models"]),
)
class AgentModelViewSet(CatalogViewSet):
    queryset = (
        AgentModel.objects.select_related("provider")
        .prefetch_related("permitted_reasoning_levels")
        .order_by("provider__slug", "name")
    )
    serializer_class = AgentModelSerializer


@extend_schema_view(
    list=extend_schema(operation_id="listReasoningLevels", tags=["Reasoning Levels"]),
    create=extend_schema(operation_id="createReasoningLevel", tags=["Reasoning Levels"]),
    partial_update=extend_schema(
        operation_id="updateReasoningLevel", tags=["Reasoning Levels"]
    ),
    destroy=extend_schema(operation_id="deleteReasoningLevel", tags=["Reasoning Levels"]),
)
class ReasoningLevelViewSet(CatalogViewSet):
    queryset = ReasoningLevel.objects.order_by("name")
    serializer_class = ReasoningLevelSerializer


class ProjectConfigurationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Shared project-scoped collection and unscoped detail behavior."""

    def list(self, request, *args, **kwargs):
        get_object_or_404(Project, pk=kwargs["project_id"])
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_id")
        return queryset.filter(project_id=project_id) if project_id else queryset


@extend_schema_view(
    list=extend_schema(operation_id="listStates", tags=["States"]),
    create=extend_schema(operation_id="createState", tags=["States"]),
    partial_update=extend_schema(operation_id="updateState", tags=["States"]),
    destroy=extend_schema(operation_id="deleteState", tags=["States"]),
)
class StateViewSet(ProjectConfigurationViewSet):
    queryset = State.objects.order_by("sort_order", "created_at")
    serializer_class = StateSerializer
    lookup_url_kwarg = "state_id"

    def perform_create(self, serializer):
        state = workflow_config.create_state(
            self.kwargs["project_id"],
            name=serializer.validated_data["name"],
            group=serializer.validated_data["group"],
            color=serializer.validated_data.get("color"),
        )
        serializer.instance = state

    def perform_update(self, serializer):
        serializer.instance = workflow_config.update_state(
            self.kwargs["state_id"], serializer.validated_data
        )

    def perform_destroy(self, instance):
        workflow_config.delete_state(instance.id)


@extend_schema_view(
    list=extend_schema(operation_id="listIssueTypes", tags=["Issue Types"]),
    create=extend_schema(operation_id="createIssueType", tags=["Issue Types"]),
    retrieve=extend_schema(operation_id="getIssueType", tags=["Issue Types"]),
    partial_update=extend_schema(operation_id="updateIssueType", tags=["Issue Types"]),
    destroy=extend_schema(operation_id="deleteIssueType", tags=["Issue Types"]),
)
class IssueTypeViewSet(ProjectConfigurationViewSet):
    queryset = IssueType.objects.order_by("sort_order", "created_at")
    serializer_class = IssueTypeSerializer
    lookup_url_kwarg = "type_id"

    def perform_create(self, serializer):
        issue_type = workflow_config.create_issue_type(
            self.kwargs["project_id"],
            name=serializer.validated_data["name"],
            level=serializer.validated_data["level"],
            color=serializer.validated_data.get("color"),
        )
        serializer.instance = issue_type

    @transaction.atomic
    def perform_update(self, serializer):
        changes = dict(serializer.validated_data)
        start_state = changes.pop("start_state", None)
        workflow_revision = changes.pop("workflow_revision", None)
        if start_state is not None:
            scoped_workflows.set_start_state(
                self.kwargs["type_id"],
                state_id=start_state.id,
                workflow_revision=workflow_revision,
            )
        serializer.instance = workflow_config.update_issue_type(
            self.kwargs["type_id"], changes
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "reassign_to",
                type=str,
                location=OpenApiParameter.QUERY,
                required=False,
            )
        ]
    )
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        workflow_config.delete_issue_type(
            instance.id, request.query_params.get("reassign_to")
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueTypeTransitionListView(APIView):
    """Canonical transition collection read and revision-guarded create."""

    def _issue_type(self, type_id):
        try:
            return IssueType.objects.get(pk=type_id)
        except IssueType.DoesNotExist as exc:
            raise NotFoundError("Work-item type not found.") from exc

    @extend_schema(
        operation_id="listIssueTypeTransitions",
        tags=["Workflows"],
        responses=IssueTypeTransitionSerializer(many=True),
    )
    def get(self, request, type_id):
        issue_type = self._issue_type(type_id)
        transitions = IssueTypeTransition.objects.filter(
            issue_type=issue_type
        ).order_by("from_state__sort_order", "to_state__sort_order", "id")
        return Response(IssueTypeTransitionSerializer(transitions, many=True).data)

    @extend_schema(
        operation_id="createIssueTypeTransition",
        tags=["Workflows"],
        request=IssueTypeTransitionSerializer,
        responses=IssueTypeTransitionSerializer,
    )
    def post(self, request, type_id):
        issue_type = self._issue_type(type_id)
        serializer = IssueTypeTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        edge = scoped_workflows.add_transition(
            issue_type.id,
            from_state_id=data["from_state"].id,
            to_state_id=data["to_state"].id,
            agent_allowed=data.get("agent_allowed", True),
            workflow_revision=data["workflow_revision"],
        )
        return Response(
            IssueTypeTransitionSerializer(edge).data,
            status=status.HTTP_201_CREATED,
        )


class IssueTypeTransitionDetailView(APIView):
    """Permission update/delete at a transition's composite domain key."""

    @extend_schema(
        operation_id="updateIssueTypeTransition",
        tags=["Workflows"],
        request=IssueTypeTransitionSerializer,
        responses=IssueTypeTransitionSerializer,
    )
    def patch(self, request, type_id, from_state_id, to_state_id):
        unexpected = set(request.data) - {"agent_allowed", "workflow_revision"}
        if unexpected:
            raise ValidationError(
                "Only agent_allowed and workflow_revision may be updated."
            )
        serializer = IssueTypeTransitionSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "agent_allowed" not in data:
            raise ValidationError("agent_allowed is required.")
        if "workflow_revision" not in data:
            raise ValidationError("workflow_revision is required.")
        edge = scoped_workflows.set_transition_permission(
            type_id,
            from_state_id,
            to_state_id,
            agent_allowed=data["agent_allowed"],
            workflow_revision=data["workflow_revision"],
        )
        return Response(IssueTypeTransitionSerializer(edge).data)

    @extend_schema(
        operation_id="deleteIssueTypeTransition",
        tags=["Workflows"],
        request={"application/json": {"type": "object"}},
        responses={204: None},
    )
    def delete(self, request, type_id, from_state_id, to_state_id):
        serializer = WorkflowRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scoped_workflows.remove_transition(
            type_id,
            from_state_id,
            to_state_id,
            workflow_revision=serializer.validated_data["workflow_revision"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class LaunchBindingListView(APIView):
    """Canonical project-scoped collection read."""

    @extend_schema(
        operation_id="listLaunchBindings",
        tags=["Launch Bindings"],
        responses=LaunchBindingSerializer(many=True),
    )
    def get(self, request, project_id):
        bindings = (
            LaunchBinding.objects.filter(issue_type__project_id=project_id)
            .select_related("issue_type", "state", "model__provider", "reasoning")
            .order_by("issue_type__sort_order", "state__sort_order", "id")
        )
        return Response(LaunchBindingSerializer(bindings, many=True).data)


class LaunchBindingDetailView(APIView):
    """Revision-guarded upsert/delete at the row's composite domain key."""

    def _locked_context(self, type_id, state_id, workflow_revision):
        try:
            issue_type = IssueType.objects.select_for_update().get(pk=type_id)
        except IssueType.DoesNotExist as exc:
            raise NotFoundError("Work-item type not found.") from exc
        if issue_type.workflow_revision != workflow_revision:
            raise ConflictError(
                "Workflow revision is stale; read the current workflow and retry."
            )
        try:
            state = State.objects.get(pk=state_id, project_id=issue_type.project_id)
        except State.DoesNotExist as exc:
            raise ValidationError("State does not belong to this project.") from exc
        return issue_type, state

    @extend_schema(
        operation_id="upsertLaunchBinding",
        tags=["Launch Bindings"],
        request=LaunchBindingSerializer,
        responses=LaunchBindingSerializer,
    )
    @transaction.atomic
    def put(self, request, type_id, state_id):
        try:
            workflow_revision = int(request.data.get("workflow_revision"))
        except (TypeError, ValueError):
            workflow_revision = -1
        issue_type, state = self._locked_context(type_id, state_id, workflow_revision)
        current = LaunchBinding.objects.filter(
            issue_type=issue_type, state=state
        ).first()
        serializer = LaunchBindingSerializer(
            current,
            data=request.data,
            context={"issue_type": issue_type, "state": state},
        )
        serializer.is_valid(raise_exception=True)
        binding = serializer.save()
        issue_type.workflow_revision += 1
        issue_type.save(update_fields=("workflow_revision", "updated_at"))
        return Response(
            LaunchBindingSerializer(binding).data,
            status=status.HTTP_200_OK if current else status.HTTP_201_CREATED,
        )

    @extend_schema(
        operation_id="deleteLaunchBinding",
        tags=["Launch Bindings"],
        request={"application/json": {"type": "object"}},
        responses={204: None},
    )
    @transaction.atomic
    def delete(self, request, type_id, state_id):
        try:
            workflow_revision = int(request.data.get("workflow_revision"))
        except (TypeError, ValueError):
            workflow_revision = -1
        issue_type, state = self._locked_context(type_id, state_id, workflow_revision)
        LaunchBinding.objects.filter(issue_type=issue_type, state=state).delete()
        issue_type.workflow_revision += 1
        issue_type.save(update_fields=("workflow_revision", "updated_at"))
        return Response(status=status.HTTP_204_NO_CONTENT)
