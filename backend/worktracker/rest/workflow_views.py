"""DRF transport for workflow transitions and launch bindings."""

from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from worktracker.rest.workflow_serializers import (
    IssueTypeTransitionCreateSerializer,
    IssueTypeTransitionSerializer,
    IssueTypeTransitionUpdateSerializer,
    LaunchBindingSerializer,
    LaunchBindingWriteSerializer,
    WorkflowRevisionSerializer,
)
from worktracker.rest.schema import (
    DeleteRequestBodyAutoSchema,
    RequiredPatchAndDeleteRequestBodyAutoSchema,
)
from worktracker.services import launch_bindings, scoped_workflows


@extend_schema_view(
    list=extend_schema(
        operation_id="listIssueTypeTransitions",
        tags=["Workflows"],
        responses=IssueTypeTransitionSerializer(many=True),
    ),
    create=extend_schema(
        operation_id="createIssueTypeTransition",
        tags=["Workflows"],
        request=IssueTypeTransitionCreateSerializer,
        responses={201: IssueTypeTransitionSerializer},
    ),
    update=extend_schema(
        operation_id="updateIssueTypeTransition",
        tags=["Workflows"],
        request=IssueTypeTransitionUpdateSerializer,
        responses=IssueTypeTransitionSerializer,
    ),
    destroy=extend_schema(
        operation_id="deleteIssueTypeTransition",
        tags=["Workflows"],
        request=WorkflowRevisionSerializer,
        responses={204: None},
    ),
)
class IssueTypeTransitionListView(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Issue-type-scoped transition CRUD with revision-guarded writes."""

    serializer_class = IssueTypeTransitionSerializer
    schema = RequiredPatchAndDeleteRequestBodyAutoSchema()
    lookup_field = "from_state_id"
    lookup_url_kwarg = "from_state_id"

    def get_serializer_class(self):
        if self.action == "create":
            return IssueTypeTransitionCreateSerializer
        if self.action == "update":
            return IssueTypeTransitionUpdateSerializer
        if self.action == "destroy":
            return WorkflowRevisionSerializer
        return IssueTypeTransitionSerializer

    def get_queryset(self):
        queryset = scoped_workflows.list_transitions(self.kwargs["type_id"])
        to_state_id = self.kwargs.get("to_state_id")
        return (
            queryset.filter(to_state_id=to_state_id)
            if to_state_id is not None
            else queryset
        )

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = scoped_workflows.add_transition(
            self.kwargs["type_id"],
            from_state_id=data["from_state"].id,
            to_state_id=data["to_state"].id,
            agent_allowed=data.get("agent_allowed", True),
            workflow_revision=data["workflow_revision"],
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        response = IssueTypeTransitionSerializer(serializer.instance)
        return Response(response.data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        serializer.instance = scoped_workflows.set_transition_permission(
            self.kwargs["type_id"],
            self.kwargs["from_state_id"],
            self.kwargs["to_state_id"],
            agent_allowed=serializer.validated_data["agent_allowed"],
            workflow_revision=serializer.validated_data["workflow_revision"],
        )

    def update(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(IssueTypeTransitionSerializer(serializer.instance).data)

    def destroy(self, request, *args, **kwargs):
        guard = self.get_serializer(data=request.data)
        guard.is_valid(raise_exception=True)
        scoped_workflows.remove_transition(
            self.kwargs["type_id"],
            self.kwargs["from_state_id"],
            self.kwargs["to_state_id"],
            workflow_revision=guard.validated_data["workflow_revision"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


IssueTypeTransitionDetailView = IssueTypeTransitionListView


@extend_schema_view(
    list=extend_schema(
        operation_id="listLaunchBindings",
        tags=["Launch Bindings"],
        responses=LaunchBindingSerializer(many=True),
    ),
    update=extend_schema(
        operation_id="upsertLaunchBinding",
        tags=["Launch Bindings"],
        request=LaunchBindingWriteSerializer,
        responses=LaunchBindingSerializer,
    ),
    destroy=extend_schema(
        operation_id="deleteLaunchBinding",
        tags=["Launch Bindings"],
        request=WorkflowRevisionSerializer,
        responses={204: None},
    ),
)
class LaunchBindingDetailView(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Project reads and revision-guarded composite-key upsert/delete."""

    serializer_class = LaunchBindingSerializer
    schema = DeleteRequestBodyAutoSchema()

    def get_serializer_class(self):
        if self.action == "destroy":
            return WorkflowRevisionSerializer
        if self.action == "update":
            return LaunchBindingWriteSerializer
        return LaunchBindingSerializer

    def get_queryset(self):
        return launch_bindings.list_launch_bindings(self.kwargs["project_id"])

    def update(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        workflow_revision = data.pop("workflow_revision")
        result = launch_bindings.upsert_launch_binding(
            self.kwargs["type_id"],
            self.kwargs["state_id"],
            workflow_revision=workflow_revision,
            **data,
        )
        return Response(
            LaunchBindingSerializer(result.binding).data,
            status=(status.HTTP_201_CREATED if result.created else status.HTTP_200_OK),
        )

    def destroy(self, request, *args, **kwargs):
        guard = self.get_serializer(data=request.data)
        guard.is_valid(raise_exception=True)
        launch_bindings.delete_launch_binding(
            self.kwargs["type_id"],
            self.kwargs["state_id"],
            workflow_revision=guard.validated_data["workflow_revision"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


LaunchBindingListView = LaunchBindingDetailView
