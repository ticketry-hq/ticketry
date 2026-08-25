from rest_framework import serializers

from apps.source_control.models import SHIP_STEP_STATUS_CHOICES, ShipRecord


class ShipStepOutcomeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=SHIP_STEP_STATUS_CHOICES)
    message = serializers.CharField(required=False, allow_null=True, max_length=512)


class ShipRecordSerializer(serializers.ModelSerializer):
    commit_shas = serializers.ListField(
        child=serializers.RegexField(r"^[0-9a-f]{40}$"),
        read_only=True,
    )
    commit_outcome = ShipStepOutcomeSerializer(read_only=True)
    push_outcome = ShipStepOutcomeSerializer(read_only=True)
    create_pr_outcome = ShipStepOutcomeSerializer(read_only=True)

    class Meta:
        model = ShipRecord
        fields = (
            "id",
            "action_id",
            "module_id",
            "task_id",
            "checkout_kind",
            "checkout_name",
            "branch",
            "commit_shas",
            "commit_outcome",
            "push_outcome",
            "create_pr_outcome",
            "pr_url",
            "pr_number",
            "pr_state",
            "action_at",
            "pr_refreshed_at",
        )
        read_only_fields = fields


class ShipRecordRefreshRequestSerializer(serializers.Serializer):
    """The action is bound entirely by URL identity and accepts no fields."""


class ShipRecordRefreshErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.ChoiceField(
        choices=(
            "provider_unavailable",
            "provider_not_authenticated",
            "provider_timeout",
            "provider_response_malformed",
            "provider_lookup_failed",
            "pull_request_not_found",
            "pull_request_url_unsupported",
        ),
        required=False,
    )


class ShipRecordPersistenceErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.ChoiceField(choices=("ship_record_persistence_failed",))
    action_result = serializers.JSONField()
