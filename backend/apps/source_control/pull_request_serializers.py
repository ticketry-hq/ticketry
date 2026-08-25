"""DRF serializers for the pull-request actions."""

from __future__ import annotations

from rest_framework import serializers

from apps.source_control.action_step_serializers import ActionStepSerializer
from apps.source_control.pull_request_action import STATUSES
from apps.source_control.push import FAILED_DIVERGED, FAILED_REJECTED


class WorktreePullRequestRequestSerializer(serializers.Serializer):
    """Which task's worktree the action runs in.

    The same shape as every other action's request on this surface: the
    checkout is the only choice a caller makes. There is no title, no body, no
    base branch, and no reviewer list — the text is generated inside the action
    and the base is resolved from the repository, so nothing a client sends
    could disagree with what the pull request ends up saying.
    """

    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class ModulePullRequestRequestSerializer(serializers.Serializer):
    """Which module's base checkout the pull-request action runs in.

    The same "checkout and nothing else" shape as every other request here.
    """

    module_id = serializers.CharField()


class WorktreePullRequestSerializer(serializers.Serializer):
    """The pull-request action's result, discriminated on ``status``.

    ``push_failed`` arrives as a 200 for the same reason it does on the
    commit-and-push action: the commit before it may well have landed, and
    ``commit_sha`` is the only record of that. The pull request then reports as
    an explicit skip rather than being absent from the list.

    ``pull_request_url`` is what a client acts on. Studio opens it in the
    system browser, which is the only reason the action is worth running from a
    review surface rather than a terminal.
    """

    status = serializers.ChoiceField(choices=STATUSES)
    #: ``stage``, ``generate_message``, ``commit``, ``push``, ``pull_request`` —
    #: in that order, every time, so a client renders progress without knowing
    #: the sequence itself.
    steps = ActionStepSerializer(many=True)
    branch = serializers.CharField()
    #: The branch the pull request merges into, resolved from the repository.
    base_branch = serializers.CharField()
    remote = serializers.CharField()
    pull_request_url = serializers.CharField(allow_null=True)
    pull_request_title = serializers.CharField(allow_null=True)
    pull_request_text_source = serializers.CharField(allow_null=True)
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
