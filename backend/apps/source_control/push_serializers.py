"""DRF serializers for the commit-and-push action and its confirmation."""

from __future__ import annotations

from rest_framework import serializers

from apps.source_control.action_step_serializers import ActionStepSerializer
from apps.source_control.push import FAILED_DIVERGED, FAILED_REJECTED
from apps.source_control.push_preview import STATES
from apps.source_control.stacked_action import STATUSES


class WorktreeActionRequestSerializer(serializers.Serializer):
    """Which task's worktree the action runs in.

    The same shape as the commit-only action's request, and for the same
    reason: the checkout is the only choice a caller makes. In particular
    there is no ``force`` and no ``remote`` — the push publishes the current
    branch to the remote that branch is configured for, or it refuses.
    """

    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class WorktreePushPreviewQuerySerializer(serializers.Serializer):
    """Which task's worktree to describe before the action runs."""

    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class ModuleActionRequestSerializer(serializers.Serializer):
    """Which module's base checkout the action runs in.

    Named by module and nothing else — no force, no remote, and no base branch,
    exactly as on the worktree's request.
    """

    module_id = serializers.CharField()


class ModulePushPreviewQuerySerializer(serializers.Serializer):
    """Which module's base checkout to describe before the action runs."""

    module_id = serializers.CharField()


class WorktreePushPreviewSerializer(serializers.Serializer):
    """What the confirmation step shows.

    Branch, remote, and commit count — and no generated commit text, which is
    not omitted here so much as not yet in existence: the message is generated
    inside the action, after this read.
    """

    state = serializers.ChoiceField(choices=STATES)
    branch = serializers.CharField(allow_blank=True)
    remote = serializers.CharField(allow_null=True)
    commit_count = serializers.IntegerField()
    dirty = serializers.BooleanField()
    detail = serializers.CharField(allow_blank=True)


class WorktreeCommitPushSerializer(serializers.Serializer):
    """The commit-and-push action's result, discriminated on ``status``.

    A ``push_failed`` status arrives as a 200, not an error: the commit before
    it may well have landed, and ``commit_sha`` is the only record of that.
    The step whose ``status`` is ``failed`` carries the sentence explaining it.

    A commit the repository's hooks refused is different — nothing was written,
    so that one still leaves through the error envelope with the hook output.
    """

    status = serializers.ChoiceField(choices=STATUSES)
    #: ``stage``, ``generate_message``, ``commit``, ``push`` — in that order,
    #: every time, so a client renders progress without knowing the sequence.
    steps = ActionStepSerializer(many=True)
    branch = serializers.CharField()
    remote = serializers.CharField()
    commit_sha = serializers.CharField(allow_null=True)
    subject = serializers.CharField(allow_null=True)
    message_source = serializers.CharField(allow_null=True)
    file_count = serializers.IntegerField()
    insertions = serializers.IntegerField()
    deletions = serializers.IntegerField()
    pushed_sha = serializers.CharField(allow_null=True)
    failure_code = serializers.ChoiceField(
        choices=(FAILED_DIVERGED, FAILED_REJECTED), allow_null=True
    )
