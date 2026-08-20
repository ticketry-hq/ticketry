"""DRF serializers for registered document and filesystem operations."""

from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.documents.models import DesignDocument


class DocumentQuerySerializer(serializers.Serializer):
    task_id = serializers.CharField(required=False)
    scope = serializers.CharField(required=False)
    project_id = serializers.CharField(required=False)
    module_id = serializers.CharField(required=False)


class DocumentSerializer(serializers.ModelSerializer):
    """Read-only public projection of a registered design document."""

    label = serializers.CharField(read_only=True)

    class Meta:
        model = DesignDocument
        fields = ("id", "rel_path", "label")
        read_only_fields = fields


@extend_schema_serializer(many=False)
class DocumentListSerializer(serializers.Serializer):
    documents = DocumentSerializer(many=True, read_only=True)


class SaveDocumentSerializer(serializers.Serializer):
    content = serializers.CharField()
    digest = serializers.CharField()


class DigestSerializer(serializers.Serializer):
    digest = serializers.CharField(read_only=True)


class DocumentConflictSerializer(serializers.Serializer):
    detail = serializers.CharField(read_only=True)
    code = serializers.CharField(read_only=True)
    digest = serializers.CharField(read_only=True)


class FilesystemCompletionQuerySerializer(serializers.Serializer):
    path = serializers.CharField(required=False, allow_blank=True, default="")


class FsEntriesSerializer(serializers.Serializer):
    entries = serializers.ListField(
        child=serializers.CharField(),
        read_only=True,
    )
