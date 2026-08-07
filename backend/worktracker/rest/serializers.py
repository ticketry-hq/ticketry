"""Model-derived serializers for the incremental DRF migration."""

import re
import uuid

from rest_framework import serializers

from worktracker.models import (
    AgentModel,
    Attachment,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
    Workspace,
)


class WorkspaceSerializer(serializers.ModelSerializer):
    """The installation-wide workspace singleton."""

    class Meta:
        model = Workspace
        fields = ("id", "slug", "name", "onboarding_required")
        read_only_fields = fields


class ProjectSerializer(serializers.ModelSerializer):
    """The single project shape; workspace selection is create-only input."""

    workspace_slug = serializers.CharField(
        max_length=64, required=False, allow_blank=False, write_only=True
    )

    class Meta:
        model = Project
        fields = ("id", "name", "slug", "description", "workspace_slug")
        read_only_fields = ("id",)

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
        if self.instance is not None and "workspace_slug" in self.initial_data:
            raise serializers.ValidationError(
                {"workspace_slug": "This field is create-only."}
            )
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


class WorkItemSerializer(serializers.ModelSerializer):
    """The single read shape for every task work-item response.

    The two model relations consumers resolve most often are deliberately
    primary keys.  The four computed fields satisfy the read-field rule: each
    is derived from this row or one of its own relations, is read-only, and is
    declared here rather than assembled in a view.
    """

    project_id = serializers.UUIDField(read_only=True)
    parent_id = serializers.UUIDField(read_only=True, allow_null=True)
    state = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    issue_type = serializers.PrimaryKeyRelatedField(read_only=True)
    key = serializers.CharField(read_only=True)
    sub_issues_count = serializers.SerializerMethodField()
    blocked_by_ids = serializers.SerializerMethodField()
    blocks_ids = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = (
            "id",
            "name",
            "project_id",
            "sequence_id",
            "state",
            "state_revision",
            "description",
            "parent_id",
            "sub_issues_count",
            "key",
            "is_archived",
            "created_at",
            "updated_at",
            "rank",
            "issue_type",
            "blocked_by_ids",
            "blocks_ids",
        )
        read_only_fields = fields

    def get_sub_issues_count(self, issue) -> int:
        annotated = getattr(issue, "child_count", None)
        return (
            annotated
            if annotated is not None
            else issue.children.filter(is_archived=False).count()
        )

    def get_blocked_by_ids(self, issue) -> list[uuid.UUID]:
        return [blocked.id for blocked in issue.blocked_by.all()]

    def get_blocks_ids(self, issue) -> list[uuid.UUID]:
        return [blocked.id for blocked in issue.blocks.all()]


class WorkItemCreateSerializer(serializers.Serializer):
    """Input for the one project-scoped work-item create."""

    name = serializers.CharField(max_length=512)
    description = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    issue_type_id = serializers.UUIDField(required=False, allow_null=True)
    state_id = serializers.UUIDField(required=False, allow_null=True)
    parent_id = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        if "priority" in self.initial_data:
            raise serializers.ValidationError(
                {"priority": "Work-item priority has been removed."}
            )
        if not attrs.get("issue_type_id") and not attrs.get("parent_id"):
            raise serializers.ValidationError(
                {
                    "issue_type_id": "This field is required unless creating a review finding."
                }
            )
        return attrs


class WorkItemBatchSerializer(serializers.Serializer):
    """Exact ids for one bounded, body-based work-item read."""

    ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        min_length=1,
        max_length=100,
    )


class WorkItemPatchSerializer(serializers.Serializer):
    """Fields supported by the domain service's guarded partial update."""

    name = serializers.CharField(max_length=512, required=False)
    description = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    state_id = serializers.UUIDField(required=False, allow_null=True)
    blocked_by_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True
    )
    origin = serializers.ChoiceField(choices=("human", "agent"), required=False)

    def validate(self, attrs):
        if "priority" in self.initial_data:
            raise serializers.ValidationError(
                {"priority": "Work-item priority has been removed."}
            )
        if not attrs:
            raise serializers.ValidationError("Supply at least one field to update.")
        return attrs


class AttachmentSerializer(serializers.ModelSerializer):
    """One attachment row; its owning issue is a bare primary key."""

    issue = serializers.PrimaryKeyRelatedField(read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = (
            "id",
            "issue",
            "filename",
            "mime_type",
            "size",
            "url",
            "created_at",
        )
        read_only_fields = fields

    def get_url(self, attachment) -> str:
        return attachment.file.url


class WorkItemReorderSerializer(serializers.Serializer):
    before_id = serializers.UUIDField(required=False, allow_null=True)
    after_id = serializers.UUIDField(required=False, allow_null=True)


class ConfigurationReorderSerializer(serializers.Serializer):
    """A complete replacement order for one project's configuration rows."""

    ordered_ids = serializers.ListField(child=serializers.UUIDField())


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


class IssueTypeTransitionSerializer(serializers.ModelSerializer):
    """One transition row plus the revision guard carried by write bodies."""

    workflow_revision = serializers.IntegerField(
        write_only=True, min_value=0, required=True
    )

    class Meta:
        model = IssueTypeTransition
        fields = (
            "id",
            "issue_type",
            "from_state",
            "to_state",
            "agent_allowed",
            "workflow_revision",
        )
        read_only_fields = ("id", "issue_type")


class WorkflowRevisionSerializer(serializers.Serializer):
    """Revision guard for quarantined workflow writes with no row body."""

    workflow_revision = serializers.IntegerField(min_value=0)


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


class LaunchBindingSerializer(serializers.ModelSerializer):
    """The one row shape for reads and composite-key writes."""

    workflow_revision = serializers.IntegerField(write_only=True, min_value=0)

    class Meta:
        model = LaunchBinding
        fields = (
            "id",
            "issue_type",
            "state",
            "prompt",
            "required_skills",
            "model",
            "reasoning",
            "auto_start",
            "subtree_run_enabled",
            "workflow_revision",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "issue_type",
            "state",
            "created_at",
            "updated_at",
        )
