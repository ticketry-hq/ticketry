"""DRF views introduced during the expand phase."""

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework import status

from worktracker.models import (
    AgentModel,
    IssueType,
    Project,
    Provider,
    ReasoningLevel,
    State,
)
from worktracker.module_order import canonical_module_queryset
from worktracker.rest.domain_ops import (
    IssueTypeDomainActionMixin,
    StateReorderActionMixin,
    ProjectOnboardingActionMixin,
)
from worktracker.rest.serializers import (
    AgentModelSerializer,
    IssueTypeSerializer,
    IssueTypeDeleteSerializer,
    ModuleCreateSerializer,
    ModuleSerializer,
    ProjectSerializer,
    ProviderSerializer,
    ReasoningLevelSerializer,
    StateSerializer,
)
from worktracker.rest.schema import DeleteRequestBodyAutoSchema
from worktracker.rest.workflow_views import (
    IssueTypeTransitionDetailView,
    IssueTypeTransitionListView,
    LaunchBindingDetailView,
    LaunchBindingListView,
)
from worktracker.services import workflow_config
from worktracker.services.errors import ConflictError
from worktracker.services.modules import create_module
from worktracker.services.projects import create_project, delete_project, update_project


@extend_schema_view(
    list=extend_schema(operation_id="listProjects", tags=["Projects"]),
    create=extend_schema(operation_id="createProject", tags=["Projects"]),
    partial_update=extend_schema(operation_id="updateProject", tags=["Projects"]),
    destroy=extend_schema(operation_id="deleteProject", tags=["Projects"]),
)
class ProjectViewSet(
    ProjectOnboardingActionMixin,
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
    list=extend_schema(
        operation_id="listModules",
        tags=["Modules"],
        parameters=[
            OpenApiParameter(
                "include_archived", bool, required=False, default=False
            )
        ],
    ),
    create=extend_schema(operation_id="createModule", tags=["Modules"]),
)
class ModuleViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Project-scoped module collection in the Canonical module order."""

    serializer_class = ModuleSerializer

    def get_serializer_class(self):
        return ModuleCreateSerializer if self.action == "create" else ModuleSerializer

    @extend_schema(
        operation_id="createModule",
        tags=["Modules"],
        request=ModuleCreateSerializer,
        responses={201: ModuleSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            ModuleSerializer(serializer.instance).data,
            status=status.HTTP_201_CREATED,
        )

    def get_queryset(self):
        include_archived = self.request.query_params.get("include_archived", "false")
        return canonical_module_queryset(
            self.kwargs["project_id"],
            include_archived=include_archived.casefold() in {"true", "1"},
        ).select_related("project", "issue_type")

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
class StateViewSet(StateReorderActionMixin, ProjectConfigurationViewSet):
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
    destroy=extend_schema(
        operation_id="deleteIssueType",
        tags=["Issue Types"],
        request=IssueTypeDeleteSerializer,
        responses={204: None},
    ),
)
class IssueTypeViewSet(IssueTypeDomainActionMixin, ProjectConfigurationViewSet):
    schema = DeleteRequestBodyAutoSchema()
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

    def perform_update(self, serializer):
        changes = dict(serializer.validated_data)
        start_state = changes.pop("start_state", None)
        workflow_revision = changes.pop("workflow_revision", None)
        serializer.instance = workflow_config.update_issue_type_configuration(
            self.kwargs["type_id"],
            changes,
            start_state_id=start_state.id if start_state is not None else None,
            workflow_revision=workflow_revision,
        )

    def destroy(self, request, *args, **kwargs):
        serializer = IssueTypeDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workflow_config.delete_issue_type(
            self.kwargs["type_id"], serializer.validated_data.get("reassign_to")
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
