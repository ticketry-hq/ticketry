from django.core.exceptions import ValidationError
from django.db import models

from .issue_type import IssueType
from .state import State


class LaunchBinding(models.Model):
    """Explicit agent launch policy for one work-item type/current-state pair."""

    issue_type = models.ForeignKey(
        IssueType, on_delete=models.CASCADE, related_name="launch_bindings"
    )
    state = models.ForeignKey(
        State, on_delete=models.CASCADE, related_name="launch_bindings"
    )
    prompt = models.TextField(blank=True, default="")
    agent = models.CharField(max_length=64, blank=True, null=True)
    model = models.CharField(max_length=255, blank=True, null=True)
    reasoning = models.CharField(max_length=32, blank=True, null=True)
    auto_start = models.BooleanField(default=False)
    subtree_run_enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("issue_type", "state"),
                name="unique_launch_binding_type_state",
            )
        ]
        ordering = ("issue_type__sort_order", "state__sort_order", "id")

    def clean(self):
        super().clean()
        errors = {}
        if (
            self.issue_type_id
            and self.state_id
            and self.issue_type.project_id != self.state.project_id
        ):
            errors["state"] = (
                "Current state and work-item type must belong to the same project."
            )

        from worktracker.services.launch_bindings import (  # avoid import cycle
            LaunchBindingError,
            validate_provider_options,
        )

        try:
            validate_provider_options(
                agent=self.agent, model=self.model, reasoning=self.reasoning
            )
        except LaunchBindingError as exc:
            errors[exc.field or "agent"] = exc.message
        if errors:
            raise ValidationError(errors)
