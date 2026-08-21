"""Canonical DRF adapters for Ticketry's host-level HTTP resources."""

from __future__ import annotations

from asgiref.sync import async_to_sync
from drf_spectacular.utils import extend_schema
from pydantic import ValidationError as PydanticValidationError
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.rest_serializers import OpenSerializer
from apps.settings_store import api as settings


class GlobalLaunchDefaultSerializer(serializers.Serializer):
    provider = serializers.CharField()
    model = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    reasoning = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class ProviderCatalogSerializer(serializers.Serializer):
    activated_providers = serializers.ListField(child=serializers.CharField())
    global_default = GlobalLaunchDefaultSerializer(required=False, allow_null=True)


class ProviderCatalogEnvelopeSerializer(serializers.Serializer):
    value = ProviderCatalogSerializer()


def _serialize_result(result):
    response_status = status.HTTP_200_OK
    if isinstance(result, tuple):
        response_status, result = result
    if hasattr(result, "model_dump"):
        result = result.model_dump(mode="json")
    return Response(result, status=response_status)


class UnprocessableEntity(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "invalid_request"


def _pydantic(model, data):
    try:
        return model.model_validate(data)
    except PydanticValidationError as exc:
        raise UnprocessableEntity(exc.errors()) from exc


class AuthenticatedAPIView(APIView):
    permission_classes = [IsAuthenticated]


class ProviderCatalogView(AuthenticatedAPIView):
    @extend_schema(tags=["settings"], responses=ProviderCatalogEnvelopeSerializer)
    def get(self, request):
        return _serialize_result(async_to_sync(settings.get_provider_catalog)())

    @extend_schema(
        tags=["settings"],
        request=ProviderCatalogEnvelopeSerializer,
        responses={200: ProviderCatalogEnvelopeSerializer, 422: OpenSerializer},
    )
    def put(self, request):
        body = _pydantic(settings.ProviderCatalogBody, request.data)
        return _serialize_result(async_to_sync(settings.put_provider_catalog)(body))
