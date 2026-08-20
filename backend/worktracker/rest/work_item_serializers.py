"""Transport allowlists for work-item and attachment REST operations."""

import uuid

from rest_framework import serializers

from worktracker.models import Attachment, Issue


class WorkItemSerializer(serializers.ModelSerializer):
    """The single read shape for every task work-item response."""

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


class WorkItemCreateSerializer(serializers.ModelSerializer):
    """Model-derived input for the project-scoped work-item create."""

    issue_type_id = serializers.UUIDField(required=False, allow_null=True)
    state_id = serializers.UUIDField(required=False, allow_null=True)
    parent_id = serializers.UUIDField(required=False, allow_null=True)

    class Meta:
        model = Issue
        fields = ("name", "description", "issue_type_id", "state_id", "parent_id")
        extra_kwargs = {
            "description": {
                "required": False,
                "allow_blank": True,
                "allow_null": True,
            }
        }

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


class WorkItemPatchSerializer(serializers.ModelSerializer):
    """Model-derived allowlist for the guarded work-item partial update."""

    parent_id = serializers.UUIDField(required=False, allow_null=True)
    state_id = serializers.UUIDField(required=False, allow_null=True)
    issue_type_id = serializers.UUIDField(required=False)
    blocked_by_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True
    )
    origin = serializers.ChoiceField(choices=("human", "agent"), required=False)

    class Meta:
        model = Issue
        fields = (
            "name",
            "description",
            "parent_id",
            "state_id",
            "issue_type_id",
            "blocked_by_ids",
            "origin",
        )
        extra_kwargs = {
            "name": {"required": False},
            "description": {
                "required": False,
                "allow_blank": True,
                "allow_null": True,
            },
        }

    def validate(self, attrs):
        if "priority" in self.initial_data:
            raise serializers.ValidationError(
                {"priority": "Work-item priority has been removed."}
            )
        if not attrs:
            raise serializers.ValidationError("Supply at least one field to update.")
        return attrs


class WorkItemFilterSerializer(serializers.Serializer):
    """Declared filters for the canonical work-item collection."""

    project = serializers.UUIDField(required=False)
    module = serializers.UUIDField(required=False)
    state = serializers.UUIDField(required=False)


class WorkItemBatchSerializer(serializers.Serializer):
    """Exact ids for one bounded, body-based work-item read."""

    ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        min_length=1,
        max_length=100,
    )


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


class AttachmentUploadSerializer(serializers.ModelSerializer):
    """Named multipart input for appending an attachment."""

    name = serializers.CharField(max_length=512, required=False, allow_blank=True)

    class Meta:
        model = Attachment
        fields = ("file", "name")
