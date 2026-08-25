"""DRF serializers for the source-control review surface.

One response contract covers both checkout kinds; the query contracts stay
separate, because a task worktree and a module base checkout are named by
different identifiers and must not be reachable through each other's request.
"""

from __future__ import annotations

import posixpath

from rest_framework import serializers

from apps.source_control.changes.change_status import CHANGE_STATUS_CHOICES
from apps.source_control.checkouts.checkout import MODULE, WORKTREE


class _ChangedPathField(serializers.CharField):
    """A repository-relative path, with traversal refused before git sees it.

    The change-set membership check in the service is the real access bound;
    this keeps a malformed path from ever reaching a git argument.
    """

    def run_validation(self, data):
        value = super().run_validation(data)
        if value.startswith("/") or ":" in value.split("/", 1)[0]:
            raise serializers.ValidationError("Path must be repository-relative.")
        normalized = posixpath.normpath(value)
        if normalized in (".", "") or normalized.startswith(".."):
            raise serializers.ValidationError("Path must stay inside the checkout.")
        if any(segment == ".." for segment in value.split("/")):
            raise serializers.ValidationError("Path must stay inside the checkout.")
        return value


class WorktreeChangesQuerySerializer(serializers.Serializer):
    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class FileDiffQuerySerializer(WorktreeChangesQuerySerializer):
    path = _ChangedPathField()


class ModuleChangesQuerySerializer(serializers.Serializer):
    module_id = serializers.CharField()


class ModuleFileDiffQuerySerializer(ModuleChangesQuerySerializer):
    path = _ChangedPathField()


class ChangedFileSerializer(serializers.Serializer):
    path = serializers.CharField()
    status = serializers.ChoiceField(choices=CHANGE_STATUS_CHOICES)
    original_path = serializers.CharField(allow_null=True)
    binary = serializers.BooleanField()
    insertions = serializers.IntegerField(allow_null=True)
    deletions = serializers.IntegerField(allow_null=True)


class PullRequestVerdictSerializer(serializers.Serializer):
    url = serializers.URLField()
    number = serializers.IntegerField(allow_null=True)
    state = serializers.ChoiceField(choices=("OPEN", "MERGED", "CLOSED"))


class WorktreeChangesSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=("changes", "no_worktree", "no_checkout")
    )
    #: Which checkout answered. Only that kind's identifiers are populated.
    checkout = serializers.ChoiceField(choices=(WORKTREE, MODULE))
    task_id = serializers.CharField(allow_null=True)
    top_level_task_id = serializers.CharField(allow_null=True)
    module_id = serializers.CharField(allow_null=True)
    path = serializers.CharField(allow_null=True)
    branch = serializers.CharField(allow_null=True)
    base_branch = serializers.CharField(allow_null=True)
    dirty = serializers.BooleanField()
    file_count = serializers.IntegerField()
    unpushed_commit_count = serializers.IntegerField(min_value=0)
    insertions = serializers.IntegerField()
    deletions = serializers.IntegerField()
    files = ChangedFileSerializer(many=True)
    reason = serializers.CharField(allow_null=True)
    pull_request = PullRequestVerdictSerializer(allow_null=True, required=False)


class FileDiffSerializer(serializers.Serializer):
    path = serializers.CharField()
    status = serializers.CharField()
    binary = serializers.BooleanField()
    patch = serializers.CharField(allow_blank=True)
    truncated = serializers.BooleanField()
