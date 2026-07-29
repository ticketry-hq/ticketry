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
    required_skills = models.JSONField(default=list, blank=True)
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

    @property
    def has_launch_policy(self) -> bool:
        """Whether this row carries launch policy rather than only a flag.

        ``subtree_run_enabled`` lives on this row but has a lifetime of its
        own, so a row can exist purely to carry that flag. Every "is a launch
        configured here" read goes through this predicate instead of through
        the row's existence, which would otherwise report a state as
        configured merely because subtree-run was switched on for it.
        """

        return bool(self.prompt.strip() or self.agent)

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
            validate_required_skills,
        )

        try:
            validate_provider_options(
                agent=self.agent, model=self.model, reasoning=self.reasoning
            )
        except LaunchBindingError as exc:
            errors[exc.field or "agent"] = exc.message
        try:
            self.required_skills = validate_required_skills(
                required_skills=self.required_skills,
                prompt=self.prompt,
            )
        except LaunchBindingError as exc:
            errors[exc.field or "required_skills"] = exc.message
        if errors:
            raise ValidationError(errors)
