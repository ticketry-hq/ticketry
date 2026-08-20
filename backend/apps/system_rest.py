"""DRF system endpoints used by the desktop supervisor."""

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


class HealthSerializer(serializers.Serializer):
    ok = serializers.BooleanField()


class SystemViewSet(viewsets.GenericViewSet):
    """Process-level system operations with no persistence dependency."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(
        operation_id="healthz_retrieve",
        tags=["system"],
        auth=[{}],
        request=None,
        responses={200: HealthSerializer},
    )
    @action(
        detail=False,
        methods=["get"],
        authentication_classes=[],
        permission_classes=[AllowAny],
    )
    def health(self, request):
        return Response(HealthSerializer({"ok": True}).data)
