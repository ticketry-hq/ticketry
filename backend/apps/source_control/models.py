from __future__ import annotations

import re
import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

CHECKOUT_BASE = "base"
CHECKOUT_WORKTREE = "worktree"
CHECKOUT_KIND_CHOICES = (
    (CHECKOUT_BASE, "Base checkout"),
    (CHECKOUT_WORKTREE, "Task worktree"),
)

STEP_DONE = "done"
STEP_SKIPPED = "skipped"
STEP_FAILED = "failed"
SHIP_STEP_STATUSES = (STEP_DONE, STEP_SKIPPED, STEP_FAILED)
SHIP_STEP_STATUS_CHOICES = (
    (STEP_DONE, "Done"),
    (STEP_SKIPPED, "Skipped"),
    (STEP_FAILED, "Failed"),
)

PR_OPEN = "open"
PR_MERGED = "merged"
PR_CLOSED = "closed"
PR_STATE_CHOICES = (
    (PR_OPEN, "Open"),
    (PR_MERGED, "Merged"),
    (PR_CLOSED, "Closed"),
)

_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
_IMMUTABLE_FIELDS = (
    "action_id",
    "module_id",
    "task_id",
    "checkout_kind",
    "checkout_name",
    "branch",
    "commit_shas",
    "commit_outcome",
    "push_outcome",
    "create_pr_outcome",
    "pr_url",
    "pr_number",
    "action_at",
)


def _validate_outcome(value, field_name: str) -> None:
    if not isinstance(value, dict):
        raise ValidationError({field_name: "A ship step outcome must be an object."})
    unexpected = set(value) - {"status", "message"}
    if unexpected:
        raise ValidationError(
            {field_name: f"Unknown ship step outcome fields: {sorted(unexpected)}."}
        )
    if value.get("status") not in SHIP_STEP_STATUSES:
        raise ValidationError(
            {field_name: "The status must be done, skipped, or failed."}
        )
    message = value.get("message")
    if message is not None and (not isinstance(message, str) or len(message) > 512):
        raise ValidationError(
            {
                field_name: "The optional sanitized message must be at most 512 characters."
            }
        )


class ShipRecord(models.Model):
    """An immutable receipt for one source-control action that started shipping."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action_id = models.UUIDField(unique=True, editable=False)
    module = models.ForeignKey(
        "worktracker.Issue",
        on_delete=models.CASCADE,
        related_name="module_ship_records",
    )
    task = models.ForeignKey(
        "worktracker.Issue",
        on_delete=models.SET_NULL,
        related_name="task_ship_records",
        null=True,
        blank=True,
    )
    checkout_kind = models.CharField(max_length=16, choices=CHECKOUT_KIND_CHOICES)
    checkout_name = models.CharField(max_length=512)
    branch = models.CharField(max_length=512)
    commit_shas = models.JSONField(blank=True)
    commit_outcome = models.JSONField()
    push_outcome = models.JSONField()
    create_pr_outcome = models.JSONField()
    pr_url = models.CharField(max_length=2048, null=True, blank=True)
    pr_number = models.PositiveIntegerField(null=True, blank=True)
    pr_state = models.CharField(
        max_length=16,
        choices=PR_STATE_CHOICES,
        null=True,
        blank=True,
    )
    action_at = models.DateTimeField()
    pr_refreshed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-action_at", "-id")
        constraints = (
            models.CheckConstraint(
                condition=Q(checkout_kind=CHECKOUT_WORKTREE) | Q(task__isnull=True),
                name="ship_checkout_task_matches_kind",
            ),
            models.CheckConstraint(
                condition=Q(pr_state__isnull=True)
                | Q(pr_state__in=(PR_OPEN, PR_MERGED, PR_CLOSED)),
                name="ship_pr_state_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        pr_url__isnull=True,
                        pr_number__isnull=True,
                        pr_state__isnull=True,
                    )
                    | Q(
                        pr_url__isnull=False,
                        pr_state__isnull=False,
                    )
                ),
                name="ship_pr_facts_complete",
            ),
        )
        indexes = (
            models.Index(
                fields=("module", "-action_at"),
                name="ship_module_time_idx",
            ),
            models.Index(
                fields=("task", "-action_at"),
                name="ship_task_time_idx",
            ),
            models.Index(
                fields=("task", "-action_at"),
                condition=Q(pr_url__isnull=False),
                name="ship_task_pr_time_idx",
            ),
        )

    def clean(self):
        errors = {}
        if self.module_id and self.module.type != "module":
            errors["module"] = "A ship record's module owner must be a module."
        if self.checkout_kind == CHECKOUT_BASE and self.task_id is not None:
            errors["task"] = "A base-checkout ship record cannot have a task owner."
        if (
            self.checkout_kind == CHECKOUT_WORKTREE
            and self.task_id is None
            and self._state.adding
        ):
            errors["task"] = "A worktree ship record requires an anchor task."
        if self.task_id is not None:
            if self.task.type != "task":
                errors["task"] = "A ship record's task owner must be a task."
            elif self.task.module_id != self.module_id:
                errors["task"] = "The anchor task must belong to the record's module."
            elif self.task.parent_id != self.module_id:
                errors["task"] = (
                    "Only a top-level worktree anchor can own a ship record."
                )
        if not isinstance(self.commit_shas, list) or any(
            not isinstance(sha, str) or _FULL_SHA.fullmatch(sha) is None
            for sha in self.commit_shas
        ):
            errors["commit_shas"] = (
                "Commit identities must be an ordered list of full lowercase SHAs."
            )
        for field_name in ("commit_outcome", "push_outcome", "create_pr_outcome"):
            try:
                _validate_outcome(getattr(self, field_name), field_name)
            except ValidationError as exc:
                errors.update(exc.message_dict)
        if self.pr_refreshed_at is not None and self.pr_url is None:
            errors["pr_refreshed_at"] = "Only a PR-bearing record can be refreshed."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            persisted = type(self).objects.get(pk=self.pk)
            changed = [
                field
                for field in _IMMUTABLE_FIELDS
                if getattr(persisted, field) != getattr(self, field)
            ]
            if changed:
                raise ValidationError(
                    f"Ship records are immutable; cannot change {', '.join(changed)}."
                )
        self.full_clean()
        return super().save(*args, **kwargs)
