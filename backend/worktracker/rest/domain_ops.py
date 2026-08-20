"""The deliberately quarantined WorkTracker domain operations."""

from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from worktracker.rest.reorder_serializers import (
    ConfigurationReorderSerializer,
    WorkItemReorderSerializer,
)
from worktracker.rest.serializers import (
    IssueTypeSerializer,
    StateSerializer,
    WorkItemBatchSerializer,
    WorkItemSerializer,
    WorkflowRevisionSerializer,
    ProjectSerializer,
)
from worktracker.services import scoped_workflows, workflow_config
from worktracker.services.work_items import batch_work_items, reorder_work_item
from worktracker.services.onboarding import acknowledge_project_onboarding


class WorkItemDomainActionMixin:
    """Quarantined bounded lookup and server-owned rank operations."""

    @extend_schema(
        operation_id="batchWorkItems",
        tags=["Work Items"],
        request=WorkItemBatchSerializer,
        responses=WorkItemSerializer(many=True),
    )
    @action(detail=False, methods=["post"])
    def batch(self, request):
        """Read at most one hundred exact ids while preserving caller order."""

        serializer = WorkItemBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = batch_work_items(serializer.validated_data["ids"])
        return Response(WorkItemSerializer(items, many=True).data)

    @extend_schema(
        operation_id="reorderWorkItem",
        tags=["Work Items"],
        request=WorkItemReorderSerializer,
        responses={200: WorkItemSerializer},
    )
    @action(detail=True, methods=["post"])
    def reorder(self, request, issue_id):
        serializer = WorkItemReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue = reorder_work_item(issue_id, **serializer.validated_data)
        return Response(WorkItemSerializer(issue).data)


class StateReorderActionMixin:
    @extend_schema(
        operation_id="reorderStates",
        tags=["States"],
        request=ConfigurationReorderSerializer,
        responses={200: StateSerializer(many=True)},
    )
    @action(detail=False, methods=["post"])
    def reorder(self, request, project_id):
        """Atomically replace a project's complete workflow-state order."""

        serializer = ConfigurationReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        states = workflow_config.reorder_states(
            project_id, serializer.validated_data["ordered_ids"]
        )
        return Response(StateSerializer(states, many=True).data)


class IssueTypeDomainActionMixin:
    @extend_schema(
        operation_id="reorderIssueTypes",
        tags=["Issue Types"],
        request=ConfigurationReorderSerializer,
        responses={200: IssueTypeSerializer(many=True)},
    )
    @action(detail=False, methods=["post"])
    def reorder(self, request, project_id):
        """Atomically replace a project's complete issue-type order."""

        serializer = ConfigurationReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue_types = workflow_config.reorder_issue_types(
            project_id, serializer.validated_data["ordered_ids"]
        )
        return Response(IssueTypeSerializer(issue_types, many=True).data)


    @extend_schema(
        operation_id="removeStateFromIssueTypeWorkflow",
        tags=["Workflows"],
        request=WorkflowRevisionSerializer,
        responses={204: None},
    )
    @action(detail=True, methods=["delete"])
    def remove_state(self, request, type_id, state_id):
        """Prune membership represented only by a type's graph reachability."""

        serializer = WorkflowRevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scoped_workflows.remove_state(
            type_id,
            state_id,
            workflow_revision=serializer.validated_data["workflow_revision"],
        )
        return Response(status=204)


class ProjectOnboardingActionMixin:
    @extend_schema(
        operation_id="acknowledgeProjectOnboarding",
        tags=["Projects"],
        request=None,
        responses={200: ProjectSerializer},
    )
    @action(detail=True, methods=["post"])
    def acknowledge_onboarding(self, request, project_id):
        """Perform the default project's monotonic onboarding acknowledgement."""

        project = acknowledge_project_onboarding(project_id)
        return Response(ProjectSerializer(project).data)
