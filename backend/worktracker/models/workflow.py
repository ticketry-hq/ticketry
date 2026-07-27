"""Persisted per-issue-type workflow transitions."""

from django.db import models

from .issue_type import IssueType
from .state import State


class IssueTypeTransition(models.Model):
    """One allowed state transition owned by an issue type."""

    issue_type = models.ForeignKey(
        IssueType, on_delete=models.CASCADE, related_name="transitions"
    )
    from_state = models.ForeignKey(
        State, on_delete=models.CASCADE, related_name="outgoing_type_transitions"
    )
    to_state = models.ForeignKey(
        State, on_delete=models.CASCADE, related_name="incoming_type_transitions"
    )
    agent_allowed = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("issue_type", "from_state", "to_state"),
                name="unique_issue_type_transition",
            )
        ]
        ordering = (
            "issue_type__sort_order",
            "from_state__sort_order",
            "to_state__sort_order",
            "id",
        )
