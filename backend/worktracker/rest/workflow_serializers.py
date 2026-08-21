"""Serializer allowlists for workflow transitions and launch bindings."""

from drf_spectacular.utils import extend_schema_serializer

from rest_framework import serializers

from worktracker.models import IssueTypeTransition, LaunchBinding
from worktracker.services.errors import ValidationError


class IssueTypeTransitionSerializer(serializers.ModelSerializer):
    """One persisted transition row returned by reads and writes."""

    class Meta:
        model = IssueTypeTransition
        fields = (
            "id",
            "issue_type",
            "from_state",
            "to_state",
            "agent_allowed",
        )
        read_only_fields = fields


class IssueTypeTransitionCreateSerializer(serializers.ModelSerializer):
    """Transition create fields plus the mandatory revision guard."""

    workflow_revision = serializers.IntegerField(
        write_only=True, min_value=0, required=True
    )

    class Meta:
        model = IssueTypeTransition
        fields = (
            "from_state",
            "to_state",
            "agent_allowed",
            "workflow_revision",
        )


@extend_schema_serializer(component_name="PatchedIssueTypeTransition")
class IssueTypeTransitionUpdateSerializer(serializers.ModelSerializer):
    """The mutable transition field plus its mandatory revision guard."""

    agent_allowed = serializers.BooleanField(required=True)
    workflow_revision = serializers.IntegerField(write_only=True, min_value=0)

    class Meta:
        model = IssueTypeTransition
        fields = ("agent_allowed", "workflow_revision")

    def to_internal_value(self, data):
        unexpected = set(data) - {"agent_allowed", "workflow_revision"}
        if unexpected:
            raise ValidationError(
                "Only agent_allowed and workflow_revision may be updated."
            )
        if "agent_allowed" not in data:
            raise ValidationError("agent_allowed is required.")
        if "workflow_revision" not in data:
            raise ValidationError("workflow_revision is required.")
        return super().to_internal_value(data)


class WorkflowRevisionSerializer(serializers.Serializer):
    """Revision guard for workflow writes with no model-field body."""

    workflow_revision = serializers.IntegerField(min_value=0)


class LaunchBindingSerializer(serializers.ModelSerializer):
    """One persisted launch binding returned by reads and writes."""

    class Meta:
        model = LaunchBinding
        fields = (
            "id",
            "issue_type",
            "state",
            "prompt",
            "required_skills",
            "entry_skill",
            "model",
            "reasoning",
            "auto_start",
            "subtree_run_enabled",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class LaunchBindingWriteSerializer(serializers.ModelSerializer):
    """Mutable launch policy fields plus the mandatory revision guard."""

    workflow_revision = serializers.IntegerField(
        write_only=True, min_value=0, required=True
    )

    class Meta:
        model = LaunchBinding
        fields = (
            "prompt",
            "required_skills",
            "entry_skill",
            "model",
            "reasoning",
            "auto_start",
            "subtree_run_enabled",
            "workflow_revision",
        )
