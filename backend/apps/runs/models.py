import uuid

from django.db import models

from worktracker.models import Issue


class AgentRun(models.Model):
    """Persist one launched coding-agent run."""

    id = models.CharField(primary_key=True)
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="agent_runs"
    )
    ticket_seq = models.IntegerField(null=True)
    # Immutable launch-time provider configuration.
    model = models.CharField(null=True)
    reasoning = models.CharField(null=True)
    # Null for an agentless shell run.
    agent = models.CharField(null=True)
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
    # Write-once snapshots of the workflow state and model used at launch.
    launch_state = models.CharField(null=True)
    launch_model = models.CharField(null=True)
    # Hooks can report lifecycle before the terminal-session mirror exists, so
    # the run itself owns the durable routing scope.
    scope = models.CharField()

    class Meta:
        db_table = "agent_runs"
        indexes = [
            models.Index(
                fields=["issue", "-started_at"],
                name="idx_agent_runs_issue_started",
            )
        ]


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
    error_details = models.JSONField(null=True, blank=True)
    retryable = models.BooleanField(default=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
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
