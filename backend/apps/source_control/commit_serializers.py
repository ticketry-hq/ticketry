"""DRF serializers for committing a checkout's changes."""

from __future__ import annotations

from rest_framework import serializers

from apps.source_control.action_step_serializers import ActionStepSerializer
from apps.source_control.commit import COMMITTED, NOTHING_TO_COMMIT
from apps.source_control.ship_record_serializers import ShipRecordSerializer


class WorktreeCommitRequestSerializer(serializers.Serializer):
    """Which task's worktree to commit.

    There is no path list: the action commits every change in the checkout, so
    the only thing a caller chooses is the checkout (CODING-961 HLD).
    """

    task_id = serializers.CharField()
    parent_id = serializers.CharField(required=False, allow_null=True)
    module_id = serializers.CharField(required=False, allow_null=True)


class ModuleCommitRequestSerializer(serializers.Serializer):
    """Which module's base checkout to commit.

    A separate request shape rather than the worktree's with an unused field:
    the checkout a mutation writes to is then fixed by the route it arrived on,
    and no combination of identifiers can make one action write the other's
    checkout.
    """

    module_id = serializers.CharField()


class WorktreeCommitSerializer(serializers.Serializer):
    """The mutation's result, discriminated on ``status``.

    Shared by both checkout kinds: what a commit did is the same story whether
    it ran in a task worktree or a module base checkout, so the response
    contract is one shape and only the request says which checkout ran.

    A failed step never appears here — a failure aborts the action and leaves
    through the error envelope instead, carrying the hook output that explains
    it. What this shape reports is which steps ran and which were skipped.
    """

    status = serializers.ChoiceField(choices=(COMMITTED, NOTHING_TO_COMMIT))
    #: Always ``stage``, ``generate_message``, ``commit`` — this action
    #: does not push, so no ``push`` step ever appears here.
    steps = ActionStepSerializer(many=True)
    branch = serializers.CharField()
    commit_sha = serializers.CharField(allow_null=True)
    subject = serializers.CharField(allow_null=True)
    message_source = serializers.CharField(allow_null=True)
    file_count = serializers.IntegerField()
    insertions = serializers.IntegerField()
    deletions = serializers.IntegerField()
    commit_shas = serializers.ListField(child=serializers.CharField())
    action_id = serializers.UUIDField(allow_null=True)
    ship_record = ShipRecordSerializer(allow_null=True)
