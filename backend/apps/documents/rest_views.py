"""DRF ViewSets for registered documents."""

from asgiref.sync import async_to_sync
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework import viewsets
from rest_framework.response import Response

from apps.documents import api as documents
from apps.documents.domain_ops import DocumentDomainActionMixin
from apps.documents.rest_serializers import (
    DigestSerializer,
    DocumentConflictSerializer,
    DocumentListSerializer,
    DocumentQuerySerializer,
    DocumentSerializer,
    SaveDocumentSerializer,
)
from apps.rest_serializers import ErrorEnvelopeSerializer


@extend_schema_view(
    list=extend_schema(
        operation_id="documents_retrieve",
        tags=["documents"],
        parameters=[DocumentQuerySerializer],
        responses={200: DocumentListSerializer, 400: ErrorEnvelopeSerializer},
    ),
    update=extend_schema(
        operation_id="docs_update",
        tags=["documents"],
        request=SaveDocumentSerializer,
        responses={
            200: DigestSerializer,
            404: ErrorEnvelopeSerializer,
            409: DocumentConflictSerializer,
        },
    ),
)
class DocumentViewSet(DocumentDomainActionMixin, viewsets.GenericViewSet):
    """List, update, and serve registered documents."""

    serializer_class = DocumentSerializer

    def list(self, request, *args, **kwargs):
        query = DocumentQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = async_to_sync(documents.list_documents)(**query.validated_data)
        return Response(DocumentListSerializer(result).data)

    def update(self, request, doc_id=None, *args, **kwargs):
        serializer = SaveDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        saved = async_to_sync(documents.save_document)(
            doc_id,
            **serializer.validated_data,
        )
        headers = {"ETag": f'"{saved.digest}"'}
        if saved.conflict:
            payload = {
                "detail": "conflict",
                "code": "conflict",
                "digest": saved.digest,
            }
            return Response(
                DocumentConflictSerializer(payload).data,
                status=status.HTTP_409_CONFLICT,
                headers=headers,
            )
        return Response(
            DigestSerializer(saved).data,
            status=status.HTTP_200_OK,
            headers=headers,
        )
