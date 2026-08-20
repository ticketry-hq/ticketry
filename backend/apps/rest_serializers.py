"""Shared host-level REST envelope serializers."""

from rest_framework import serializers


class OpenSerializer(serializers.Serializer):
    """Named JSON object used where the established payload is intentionally open."""

    value = serializers.JSONField(required=False)


class ErrorEnvelopeSerializer(serializers.Serializer):
    detail = serializers.JSONField()
    code = serializers.CharField(required=False)
