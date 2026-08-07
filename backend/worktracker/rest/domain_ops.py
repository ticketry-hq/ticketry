"""The deliberately quarantined WorkTracker domain operations."""

from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from worktracker.rest.serializers import (
    ConfigurationReorderSerializer,
    IssueTypeSerializer,
    StateSerializer,
    WorkItemReorderSerializer,
    WorkItemSerializer,
    WorkflowRevisionSerializer,
    WorkspaceSerializer,
)
from worktracker.services import scoped_workflows, workflow_config
from worktracker.services.work_items import reorder_work_item
from worktracker.services.workspaces import acknowledge_onboarding


class WorkItemReorderView(APIView):
    """Allocate the moved row's server-owned fractional rank."""

    @extend_schema(
        operation_id="reorderWorkItem",
        tags=["Work Items"],
        request=WorkItemReorderSerializer,
        responses=WorkItemSerializer,
    )
    def post(self, request, issue_id):
        serializer = WorkItemReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue = reorder_work_item(issue_id, **serializer.validated_data)
        return Response(WorkItemSerializer(issue).data)


class StateReorderView(APIView):
    """Atomically replace a project's complete workflow-state order."""

    @extend_schema(
        operation_id="reorderStates",
        tags=["States"],
        request=ConfigurationReorderSerializer,
        responses=StateSerializer(many=True),
    )
    def post(self, request, project_id):
        serializer = ConfigurationReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        states = workflow_config.reorder_states(
            project_id, serializer.validated_data["ordered_ids"]
        )
        return Response(StateSerializer(states, many=True).data)


class IssueTypeReorderView(APIView):
    """Atomically replace a project's complete issue-type order."""

    @extend_schema(
        operation_id="reorderIssueTypes",
        tags=["Issue Types"],
        request=ConfigurationReorderSerializer,
        responses=IssueTypeSerializer(many=True),
    )
    def post(self, request, project_id):
        serializer = ConfigurationReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue_types = workflow_config.reorder_issue_types(
            project_id, serializer.validated_data["ordered_ids"]
        )
        return Response(IssueTypeSerializer(issue_types, many=True).data)


class RemoveStateFromWorkflowView(APIView):
    """Prune membership represented only by a type's graph reachability."""

    @extend_schema(
        operation_id="removeStateFromIssueTypeWorkflow",
        tags=["Workflows"],
        request=WorkflowRevisionSerializer,
        responses={204: None},
    )
    def delete(self, request, type_id, state_id):
        serializer = WorkflowRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scoped_workflows.remove_state(
            type_id,
            state_id,
            workflow_revision=serializer.validated_data["workflow_revision"],
        )
        return Response(status=204)


class AcknowledgeOnboardingView(APIView):
    """Perform the installation's monotonic onboarding acknowledgement."""

    @extend_schema(
        operation_id="acknowledgeWorkspaceOnboarding",
        tags=["Workspace"],
        request=None,
        responses=WorkspaceSerializer,
    )
    def post(self, request):
        return Response(WorkspaceSerializer(acknowledge_onboarding()).data)
