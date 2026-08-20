"""Model-derived serializers for the incremental DRF migration."""

import re
from rest_framework import serializers

from worktracker.models import (
    AgentModel,
    Issue,
    IssueType,
    Project,
    Provider,
    ReasoningLevel,
    State,
)
from worktracker.rest.workflow_serializers import (
    IssueTypeTransitionSerializer,
    LaunchBindingSerializer,
    WorkflowRevisionSerializer,
)
from worktracker.rest.work_item_serializers import (
    AttachmentSerializer,
    AttachmentUploadSerializer,
    WorkItemBatchSerializer,
    WorkItemCreateSerializer,
    WorkItemFilterSerializer,
    WorkItemPatchSerializer,
    WorkItemSerializer,
)


class ProjectSerializer(serializers.ModelSerializer):
    """The installation-wide project shape."""

    class Meta:
        model = Project
        fields = (
            "id",
            "name",
            "slug",
            "description",
            "manual_module_order",
            "onboarding_required",
        )
        # The ordering mode is a durable project fact clients read to decide
        # which server-owned module ordering rule applies. It flips only through
        # the module reorder domain operation, never through this general-purpose
        # project update.
        read_only_fields = ("id", "manual_module_order", "onboarding_required")
        extra_kwargs = {"slug": {"validators": []}}

    def validate_slug(self, value):
        if self.instance is not None:
            return value
        normalized = value.upper()
        if re.fullmatch(r"[A-Z]{3}", normalized) is None:
            raise serializers.ValidationError(
                "Project key must be exactly three letters, using only A-Z."
            )
        return normalized

    def validate(self, attrs):
        if self.instance is not None and "slug" in self.initial_data:
            raise serializers.ValidationError({"slug": "This field is immutable."})
        return attrs


class ModuleSerializer(serializers.ModelSerializer):
    """The one module shape, with its issue type represented by a bare id."""

    project_id = serializers.UUIDField(read_only=True)
    issue_type = serializers.PrimaryKeyRelatedField(read_only=True)
    key = serializers.CharField(read_only=True)

    class Meta:
        model = Issue
        fields = (
            "id",
            "name",
            "project_id",
            "sequence_id",
            "key",
            "is_archived",
            "issue_type",
        )
        read_only_fields = (
            "id",
            "project_id",
            "sequence_id",
            "key",
            "is_archived",
            "issue_type",
        )


class ModuleCreateSerializer(serializers.Serializer):
    """Input for the project-scoped module create."""

    name = serializers.CharField(max_length=512)
    issue_type_id = serializers.UUIDField()


class StateSerializer(serializers.ModelSerializer):
    """The one workflow-state shape for reads and writes."""

    color = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = State
        fields = (
            "id",
            "project",
            "name",
            "group",
            "color",
            "sort_order",
            "is_protected",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "project",
            "sort_order",
            "is_protected",
            "created_at",
            "updated_at",
        )


class IssueTypeSerializer(serializers.ModelSerializer):
    """The one issue-type shape for reads and writes in this migration slice."""

    color = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    start_state = serializers.PrimaryKeyRelatedField(
        queryset=State.objects.all(), required=False, allow_null=True
    )
    workflow_revision = serializers.IntegerField(required=False, min_value=0)

    class Meta:
        model = IssueType
        fields = (
            "id",
            "project",
            "name",
            "level",
            "color",
            "sort_order",
            "start_state",
            "workflow_revision",
            "is_pathfind",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "project",
            "sort_order",
            "is_pathfind",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        if self.instance is not None and "level" in self.initial_data:
            raise serializers.ValidationError({"level": "This field is immutable."})
        if self.instance is None and (
            "start_state" in self.initial_data
            or "workflow_revision" in self.initial_data
        ):
            raise serializers.ValidationError(
                {
                    "start_state": "Configure the start state after creating the issue type."
                }
            )
        changing_start = "start_state" in self.initial_data
        supplied_revision = "workflow_revision" in self.initial_data
        if changing_start and attrs.get("start_state") is None:
            raise serializers.ValidationError(
                {"start_state": "Choose a state; the workflow start cannot be cleared."}
            )
        if changing_start and not supplied_revision:
            raise serializers.ValidationError(
                {
                    "workflow_revision": "This field is required when changing start_state."
                }
            )
        if supplied_revision and not changing_start:
            raise serializers.ValidationError(
                {"workflow_revision": "This field is only valid with start_state."}
            )
        return attrs


class IssueTypeDeleteSerializer(serializers.Serializer):
    """Optional explicit reassignment accompanying issue-type deletion."""

    reassign_to = serializers.UUIDField(required=False, allow_null=True)


class ProviderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Provider
        fields = ("id", "slug", "activated", "supports_unattended")
        read_only_fields = ("id", "slug", "supports_unattended")


class ReasoningLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReasoningLevel
        fields = ("id", "name")
        read_only_fields = ("id",)


class AgentModelSerializer(serializers.ModelSerializer):
    permitted_reasoning_levels = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=ReasoningLevel.objects.all(),
        required=False,
    )

    class Meta:
        model = AgentModel
        fields = ("id", "provider", "name", "permitted_reasoning_levels")
        read_only_fields = ("id",)
