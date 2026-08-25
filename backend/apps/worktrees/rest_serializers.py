"""DRF serializers for live worktree operations."""

from rest_framework import serializers

from apps.worktrees.models import Worktree


class WorktreeRecordQuerySerializer(serializers.Serializer):
    module_id = serializers.CharField()


class WorktreeRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = Worktree
        fields = ("task_id",)
        read_only_fields = fields


class WorktreeQuerySerializer(serializers.Serializer):
    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class WorktreeContextQuerySerializer(serializers.Serializer):
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class CreateWorktreeSerializer(serializers.Serializer):
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)
    project_id = serializers.CharField(required=False, allow_null=True)
    ticket_seq = serializers.IntegerField(required=False, allow_null=True)
    task_name = serializers.CharField(required=False, allow_null=True)


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


class DiscardSerializer(serializers.Serializer):
    removed = serializers.BooleanField()
    reason = serializers.CharField()


class ActiveWorktreeSerializer(serializers.ModelSerializer):
    """Read-only identity and checkout facts for one live task worktree."""

    class Meta:
        model = Worktree
        fields = (
            "id",
            "task_id",
            "project_id",
            "module_id",
            "ticket_seq",
            "path",
            "branch",
            "base_branch",
            "status",
            "created_at",
        )
        read_only_fields = fields
