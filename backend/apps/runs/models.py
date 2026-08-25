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
    # Null for a run that has no provider at all — a shell run (#665). Every
    # reader must treat the absence as "this run is not an agent run" rather
    # than substituting a provider slug.
    agent = models.CharField(null=True)
    status = models.CharField()
    started_at = models.CharField()
    ended_at = models.CharField(null=True)
    exit_code = models.IntegerField(null=True)
    error = models.CharField(null=True)
    # Exact launch prompt passed to the provider command.
    initial_prompt = models.TextField(null=True)
    cwd = models.CharField(null=True)
    provider_session_id = models.CharField(null=True)
    lifecycle_state = models.CharField(null=True)
    lifecycle_updated_at = models.CharField(null=True)
    design_dir = models.CharField(null=True)
    resumed_from = models.CharField(null=True)
    # Write-once launch snapshots (#693): the display name of the workflow
    # state this run was launched in, and the model launch configuration
    # actually resolved. Both are decisions frozen at spawn, not caches of a
    # row that still exists — the work item moves on and the binding can be
    # edited, and neither rewrites what this conversation was started as. Null
    # means "not recorded" (a run predating the columns, or a scope that has no
    # workflow state); readers must never substitute the work item's current
    # state or a provider's default model. See the terminals ADR
    # ``0003-runs-snapshot-the-state-they-launched-in``.
    launch_state = models.CharField(null=True)
    launch_model = models.CharField(null=True)
    # Write-once launch snapshots. A resumed conversation must keep the
    # reasoning level and interactive/unattended surface it started with.
    launch_reasoning = models.CharField(null=True)
    launch_unattended = models.BooleanField(default=False)
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
