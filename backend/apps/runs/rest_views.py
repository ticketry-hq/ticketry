"""DRF ViewSets for run resources."""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.runs.domain_ops import AutomationAttemptActionMixin, RunLifecycleActionMixin
from apps.runs.models import AutomationAttempt
from apps.runs.rest_serializers import AutomationAttemptSerializer
from apps.terminals.rest_authentication import LifecycleRunScopedAuthentication


class RunViewSet(RunLifecycleActionMixin, viewsets.GenericViewSet):
    """Owning ViewSet for run lifecycle and status operations."""

    authentication_classes = (LifecycleRunScopedAuthentication,)
    permission_classes = (IsAuthenticated,)


class AutomationAttemptViewSet(
    AutomationAttemptActionMixin,
    viewsets.GenericViewSet,
):
    """Owning ViewSet for durable automated-launch attempts."""

    queryset = AutomationAttempt.objects.all()
    serializer_class = AutomationAttemptSerializer
    lookup_url_kwarg = "attempt_id"
