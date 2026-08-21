"""DRF serializers for run lifecycle ingress."""

from rest_framework import serializers

from apps.runs.models import AutomationAttempt
from studio_server.contracts import LifecycleEvent


class LifecycleEventSerializer(serializers.Serializer):
    agent_run_id = serializers.CharField()
    agent = serializers.ChoiceField(choices=("claude", "agy", "codex", "gemini"))
    kind = serializers.ChoiceField(
        choices=(
            "session_start",
            "turn_start",
            "tool_use",
            "awaiting_input",
            "permission_required",
            "turn_complete",
            "idle",
            "error",
            "session_end",
        )
    )
    ts = serializers.CharField()
    message = serializers.CharField(required=False, allow_null=True)
    source = serializers.ChoiceField(
        choices=("hook", "inactivity", "transport"), required=False
    )
    provider_session_id = serializers.CharField(required=False, allow_null=True)

    def create(self, validated_data):
        return LifecycleEvent.model_construct(**validated_data)


class LifecycleAcceptedSerializer(serializers.Serializer):
    accepted = LifecycleEventSerializer()
    received_at = serializers.CharField()


class AutomationAttemptSerializer(serializers.ModelSerializer):
    """Public projection of one durable automated-launch attempt."""

    attempt_id = serializers.CharField(source="id", read_only=True)
    root_attempt_id = serializers.SerializerMethodField()
    retry_of_attempt_id = serializers.CharField(
        source="retry_of_id", read_only=True, allow_null=True
    )
    work_item_id = serializers.CharField(source="issue_id", read_only=True)
    status = serializers.ChoiceField(
        choices=AutomationAttempt.Status.choices, read_only=True
    )
    error = serializers.CharField(read_only=True, allow_null=True)
    failure = serializers.JSONField(
        source="error_details", read_only=True, allow_null=True
    )
    retryable = serializers.SerializerMethodField()
    agent_run_id = serializers.CharField(read_only=True, allow_null=True)
    updated_at = serializers.SerializerMethodField()

    class Meta:
        model = AutomationAttempt
        fields = (
            "attempt_id",
            "root_attempt_id",
            "retry_of_attempt_id",
            "work_item_id",
            "status",
            "error",
            "failure",
            "retryable",
            "agent_run_id",
            "updated_at",
        )
        read_only_fields = fields

    def get_root_attempt_id(self, attempt: AutomationAttempt) -> str:
        return str(attempt.root_attempt_id or attempt.id)

    def get_retryable(self, attempt: AutomationAttempt) -> bool:
        return (
            attempt.status == AutomationAttempt.Status.FAILED and attempt.retryable
        )

    def get_updated_at(self, attempt: AutomationAttempt) -> str:
        return attempt.updated_at.isoformat()
