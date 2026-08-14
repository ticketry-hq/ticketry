"""Request shapes for the REST reorder operations.

Reordering is its own REST concern: a work-item move names its neighbors and
may carry a module's first-drag baseline, while a configuration reorder
replaces one project's row order outright. Both live here rather than in the
general model-derived serializer module.
"""

from rest_framework import serializers


class WorkItemReorderSerializer(serializers.Serializer):
    """The moved work item's neighbors, plus a module's first-drag baseline.

    ``initial_order_ids`` is the complete module order the user could see when
    they started the very first drag in an automatic project. The server
    freezes it into ranks before applying the move, so a client never has to
    infer the durable ordering mode from its own history (#360).
    """

    before_id = serializers.UUIDField(required=False, allow_null=True)
    after_id = serializers.UUIDField(required=False, allow_null=True)
    initial_order_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True
    )


class ConfigurationReorderSerializer(serializers.Serializer):
    """A complete replacement order for one project's configuration rows."""

    ordered_ids = serializers.ListField(child=serializers.UUIDField())
