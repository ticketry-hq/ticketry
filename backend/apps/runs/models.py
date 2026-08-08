import uuid

from django.db import models

from worktracker.models import Issue


class AgentRun(models.Model):
    """Persist one launched coding-agent run."""

    class Kind(models.TextChoices):
        TERMINAL = "terminal", "Terminal"
        CHAT = "chat", "Chat"

    id = models.CharField(primary_key=True)
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="agent_runs"
    )
    ticket_seq = models.IntegerField(null=True)
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
    # Hooks can report lifecycle before the terminal-session mirror exists, so
    # the run itself owns the durable routing scope.
    scope = models.CharField()
    # Provider and presentation are independent. Existing runs remain terminal
    # runs; structured chat runs use the same identity/lifecycle row without a
    # tmux session mirror.
    run_kind = models.CharField(
        max_length=16,
        choices=Kind.choices,
        default=Kind.TERMINAL,
    )

    class Meta:
        db_table = "agent_runs"
        indexes = [
            models.Index(
                fields=["issue", "-started_at"],
                name="idx_agent_runs_issue_started",
            )
        ]


class AgentChatSession(models.Model):
    """Durable provider-thread state for one structured Chat run."""

    class Status(models.TextChoices):
        STARTING = "starting", "Starting"
        READY = "ready", "Ready"
        RUNNING = "running", "Running"
        INTERRUPTED = "interrupted", "Interrupted"
        STOPPED = "stopped", "Stopped"
        ERROR = "error", "Error"

    run = models.OneToOneField(
        AgentRun,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="chat_session",
    )
    provider_thread_id = models.CharField(null=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.STARTING,
    )
    active_turn_id = models.CharField(null=True)
    last_error = models.TextField(null=True)
    resume_token = models.CharField(max_length=32, null=True)
    # The next sequence is allocated under a row lock before an event insert.
    # It gives reconnecting clients one monotonic cursor per Chat run.
    next_sequence = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "agent_chat_sessions"


class AgentChatEvent(models.Model):
    """One normalized, replayable event in a Chat run transcript."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        AgentChatSession,
        on_delete=models.CASCADE,
        related_name="events",
    )
    sequence = models.PositiveBigIntegerField()
    event_type = models.CharField(max_length=96)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "agent_chat_events"
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "sequence"],
                name="uniq_chat_event_session_sequence",
            )
        ]
        indexes = [
            models.Index(
                fields=["session", "sequence"],
                name="idx_chat_event_session_seq",
            )
        ]


class AgentChatCommand(models.Model):
    """Durable idempotency record for a client-originated Chat command."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        AgentChatSession,
        on_delete=models.CASCADE,
        related_name="commands",
    )
    command_id = models.CharField(max_length=128)
    command_type = models.CharField(max_length=32)
    request_fingerprint = models.CharField(max_length=64, null=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    result = models.JSONField(null=True)
    error = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "agent_chat_commands"
        constraints = [
            models.UniqueConstraint(
                fields=["session", "command_id"],
                name="uniq_chat_command_session_id",
            )
        ]


class AgentChatLaunchCommand(models.Model):
    """Durable idempotency claim created before a Chat session exists."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    command_id = models.CharField(max_length=128, unique=True)
    request_fingerprint = models.CharField(max_length=64)
    agent_run_id = models.CharField(max_length=255)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    error = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "agent_chat_launch_commands"


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
