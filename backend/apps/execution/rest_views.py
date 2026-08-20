"""DRF ViewSets for work-item execution resources and commands."""

from rest_framework import viewsets

from apps.execution.domain_ops import (
    GraphRunDomainActionMixin,
    WorkItemExecutionDomainActionMixin,
)
from apps.execution.rest_serializers import GraphSerializer, RunNowResponseSerializer


class GraphRunViewSet(GraphRunDomainActionMixin, viewsets.GenericViewSet):
    """A work-item-scoped singleton graph-run campaign."""

    serializer_class = GraphSerializer
    lookup_url_kwarg = "issue_id"


class WorkItemExecutionViewSet(
    WorkItemExecutionDomainActionMixin,
    viewsets.GenericViewSet,
):
    """Execution commands scoped to one work item."""

    serializer_class = RunNowResponseSerializer
    lookup_url_kwarg = "issue_id"
