"""Quarantined document domain operations exposed through DRF actions."""

from asgiref.sync import async_to_sync
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.documents import api as documents
from apps.documents.rest_serializers import (
    FilesystemCompletionQuerySerializer,
    FsEntriesSerializer,
)
from apps.rest_serializers import ErrorEnvelopeSerializer


class DocumentDomainActionMixin:
    """Expose non-CRUD document and filesystem operations."""

    @extend_schema(
        operation_id="fs_complete_retrieve",
        tags=["documents"],
        parameters=[FilesystemCompletionQuerySerializer],
        responses=FsEntriesSerializer,
    )
    @action(detail=False, methods=["get"])
    def complete(self, request):
        query = FilesystemCompletionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = async_to_sync(documents.fs_complete)(query.validated_data["path"])
        return Response(FsEntriesSerializer(result).data)

    @extend_schema(
        operation_id="docs_retrieve",
        tags=["documents"],
        auth=[{}],
        responses={
            (200, "application/octet-stream"): OpenApiTypes.BINARY,
            404: ErrorEnvelopeSerializer,
        },
    )
    @action(
        detail=True,
        methods=["get"],
        authentication_classes=[],
        permission_classes=[AllowAny],
    )
    def asset(self, request, doc_id, asset_path):
        asset = async_to_sync(documents.read_document_asset)(doc_id, asset_path)
        response = HttpResponse(asset.content, content_type=asset.media_type)
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        if asset.etag is not None:
            response["ETag"] = f'"{asset.etag}"'
        return response
