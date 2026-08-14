from django.core.exceptions import ValidationError
from django.db import models

from .issue_type import IssueType
from .provider_catalog import AgentModel, ReasoningLevel
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
    model = models.ForeignKey(
        AgentModel,
        on_delete=models.PROTECT,
        related_name="launch_bindings",
        blank=True,
        null=True,
    )
    reasoning = models.ForeignKey(
        ReasoningLevel,
        on_delete=models.PROTECT,
        related_name="launch_bindings",
        blank=True,
        null=True,
    )
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

        Automation flags no longer create flag-only rows. Every "is a launch
        configured here" read still goes through this predicate because the
        prompt can deliberately inherit its model from the global default.
        """

        return bool(self.prompt.strip() or self.model_id)

    @property
    def provider_slug(self) -> str | None:
        """Return the provider implied by the selected catalog model."""

        return self.model.provider.slug if self.model_id else None

    @property
    def model_name(self) -> str | None:
        return self.model.name if self.model_id else None

    @property
    def reasoning_name(self) -> str | None:
        return self.reasoning.name if self.reasoning_id else None

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
            validate_required_skills,
        )

        if self.reasoning_id and not self.model_id:
            errors["reasoning"] = "Choose a model before configuring reasoning."
        elif (
            self.reasoning_id
            and self.model_id
            and not self.model.permitted_reasoning_levels.filter(
                pk=self.reasoning_id
            ).exists()
        ):
            errors["reasoning"] = (
                f"Reasoning '{self.reasoning.name}' is not permitted for model "
                f"'{self.model.name}'."
            )
        if (self.auto_start or self.subtree_run_enabled) and not self.has_launch_policy:
            errors["auto_start"] = (
                "Configure a launch binding before enabling automation."
            )
        try:
            self.required_skills = validate_required_skills(
                required_skills=self.required_skills,
                prompt=self.prompt,
            )
        except LaunchBindingError as exc:
            errors[exc.field or "required_skills"] = exc.message
        if errors:
            raise ValidationError(errors)
