"""DRF ViewSets for terminal resources."""

from rest_framework import viewsets

from apps.terminals.domain_ops import TerminalDomainActionMixin
from apps.terminals.rest_serializers import TerminalRunSerializer


class TerminalViewSet(TerminalDomainActionMixin, viewsets.GenericViewSet):
    """Owning ViewSet for terminal sessions and their commands."""

    serializer_class = TerminalRunSerializer
