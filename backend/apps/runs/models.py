import uuid

from django.db import models

from worktracker.models import Issue


class AgentRun(models.Model):
    """Persist one launched coding-agent run."""

    id = models.CharField(primary_key=True)
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="agent_runs"
    )
    agent = models.CharField()
    status = models.CharField()
    started_at = models.CharField()
    ended_at = models.CharField(null=True)
    exit_code = models.IntegerField(null=True)
    error = models.CharField(null=True)
    cwd = models.CharField(null=True)
    provider_session_id = models.CharField(null=True)
    lifecycle_state = models.CharField(null=True)
    lifecycle_updated_at = models.CharField(null=True)
    design_dir = models.CharField(null=True)
    resumed_from = models.CharField(null=True)
    # Hooks can report lifecycle immediately after launch, so the run owns the
    # durable routing scope directly.
    scope = models.CharField()
    # Document context belongs to the run: resume creates a new run and copies
    # this value, while every non-doc-chat run leaves it null.
    doc_rel_path = models.CharField(null=True)
    # Stable identity of the terminal transport owner (currently the
    # profile-scoped tmux socket). Null means terminal provisioning has not
    # completed; migrated transports use the explicit unknown owner "legacy".
    terminal_owner_id = models.CharField(null=True)

    class Meta:
        db_table = "agent_runs"


class AutomationAttempt(models.Model):
    """One durable agent-start attempt correlated to a committed transition."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    transition_id = models.UUIDField()
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="automation_attempts"
    )
    from_state_id = models.UUIDField()
    to_state_id = models.UUIDField()
    workflow_revision = models.PositiveIntegerField()
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING
    )
    agent = models.CharField(max_length=64, null=True, blank=True)
    agent_run_id = models.CharField(max_length=255, null=True, blank=True)
    error = models.TextField(null=True, blank=True)
    retry_of = models.OneToOneField(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="retry_attempt",
    )
    root_attempt = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="retry_descendants",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "automation_attempts"
        indexes = [
            models.Index(
                fields=["issue", "-created_at"],
                name="idx_auto_attempt_issue_created",
            )
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["transition_id"],
                condition=models.Q(retry_of__isnull=True),
                name="uniq_auto_attempt_transition_root",
            )
        ]
