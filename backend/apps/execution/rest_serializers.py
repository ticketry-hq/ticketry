"""DRF serializers for work-item execution operations."""

from rest_framework import serializers
from rest_framework.exceptions import APIException

from apps.execution.execution_mode import EXECUTION_MODE_CHOICES


class ExecutionRequestValidationError(APIException):
    status_code = 422
    default_code = "invalid_request"


class ExecutionModeField(serializers.ChoiceField):
    """Keep domain-invalid JSON values on the structured service error path."""

    def to_internal_value(self, data):
        return data

    def to_representation(self, value):
        return value


class GraphRunRequestSerializer(serializers.Serializer):
    """Optional launch context for arming or advancing a graph run."""

    agent = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    mode = ExecutionModeField(
        choices=EXECUTION_MODE_CHOICES,
        required=False,
        allow_null=True,
    )

    def validate_agent(self, value):
        return value or None

    def validate_mode(self, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class StrictOptionalAgentField(serializers.CharField):
    """Match the established nullable, string-only provider override."""

    def to_internal_value(self, data):
        if data is not None and not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class AgentOverrideSerializer(serializers.Serializer):
    agent = StrictOptionalAgentField(
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_agent(self, value):
        return value or None

    def is_valid(self, *, raise_exception=False):
        try:
            return super().is_valid(raise_exception=raise_exception)
        except serializers.ValidationError as exc:
            raise ExecutionRequestValidationError(exc.detail) from exc


class GraphNodeSerializer(serializers.Serializer):
    id = serializers.CharField()
    state = serializers.CharField()
    parent_id = serializers.CharField(allow_null=True)
    blocked_by = serializers.ListField(child=serializers.CharField())


class GraphSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    nodes = GraphNodeSerializer(many=True)


class GraphRunResultSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    launched = serializers.ListField(child=serializers.CharField())


class GraphResetResultSerializer(serializers.Serializer):
    root_id = serializers.CharField()
    cleared = serializers.ListField(child=serializers.CharField())


class RunNowRequestSerializer(serializers.Serializer):
    """Caller origin accepted by the guarded workflow transition."""

    origin = serializers.ChoiceField(
        choices=("human", "agent"),
        required=False,
        default="human",
    )

    def is_valid(self, *, raise_exception=False):
        try:
            return super().is_valid(raise_exception=raise_exception)
        except serializers.ValidationError as exc:
            raise ExecutionRequestValidationError(exc.detail) from exc


class LaunchedAgentResponseSerializer(serializers.Serializer):
    target_id = serializers.CharField()
    agent = serializers.CharField()
    agent_run_id = serializers.CharField()


class CommittedStateSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()


class RunNowResponseSerializer(serializers.Serializer):
    target_id = serializers.CharField()
    committed_state = CommittedStateSerializer()
    run = LaunchedAgentResponseSerializer()


class RunNowRefusalSerializer(serializers.Serializer):
    """Stable partial-outcome envelope returned by every Run Now refusal."""

    target_id = serializers.CharField()
    committed_state = CommittedStateSerializer(allow_null=True)
    run = LaunchedAgentResponseSerializer(allow_null=True)
    detail = serializers.CharField()
    code = serializers.CharField()
