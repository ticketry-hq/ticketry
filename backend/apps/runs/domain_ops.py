"""Quarantined run domain operations exposed through DRF actions."""

from asgiref.sync import async_to_sync
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.errors import ApplicationError
from apps.rest_serializers import OpenSerializer
from apps.runs import api as runs
from apps.runs.rest_serializers import (
    AutomationAttemptSerializer,
    LifecycleAcceptedSerializer,
    LifecycleEventSerializer,
)
from apps.terminals.rest_authentication import LifecycleRunScopedAuthentication


class RunLifecycleActionMixin:
    """Ingest lifecycle events authenticated to one launched run."""

    @extend_schema(
        operation_id="lifecycle_events_create",
        tags=["runs"],
        auth=[{}],
        request=LifecycleEventSerializer,
        responses={202: LifecycleAcceptedSerializer, 401: OpenSerializer},
    )
    @action(
        detail=False,
        methods=["post"],
        authentication_classes=[LifecycleRunScopedAuthentication],
        permission_classes=[IsAuthenticated],
    )
    def lifecycle_events(self, request):
        serializer = LifecycleEventSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        authorized_run_id = request.user.agent_run_id
        if authorized_run_id is not None and authorized_run_id != event.agent_run_id:
            raise ApplicationError(
                401,
                "authorization_run_mismatch",
                code="caller_run_mismatch",
            )

        response_status, payload = async_to_sync(runs.ingest_lifecycle_event)(event)
        response = LifecycleAcceptedSerializer(data=payload)
        response.is_valid(raise_exception=True)
        return Response(
            response.data, status=response_status or status.HTTP_202_ACCEPTED
        )


class AutomationAttemptActionMixin:
    """Explicit user retry of one failed automated-launch attempt."""

    @extend_schema(
        operation_id="automation_attempts_retry_create",
        tags=["runs"],
        request=None,
        responses={
            200: AutomationAttemptSerializer,
            404: OpenSerializer,
            409: OpenSerializer,
        },
    )
    @action(detail=True, methods=["post"])
    def retry(self, request, attempt_id):
        attempt = runs.retry_automation_attempt(attempt_id)
        return Response(AutomationAttemptSerializer(attempt).data)
