from django.db import models

from apps.runs.models import AgentRun


class AgentTerminalSession(models.Model):
    """Persist the application mirror for one durable terminal runtime."""

    agent_run = models.OneToOneField(
        AgentRun,
        primary_key=True,
        on_delete=models.CASCADE,
        db_column="agent_run_id",
        db_constraint=True,
    )
    tmux_session_name = models.CharField()
    task_id = models.CharField()
    module_id = models.CharField()
    project_id = models.CharField()
    agent = models.CharField()
    created_at = models.CharField()
    terminated_at = models.CharField(null=True)
    runtime_namespace = models.CharField(max_length=64, null=True, db_index=True)
    runtime_cleanup_pending = models.BooleanField(default=False)
    scope = models.CharField(db_default="task")
    # #625: the repo design-dir-relative .html a doc-chat run is scoped to.
    # Null for every non-doc-chat row; lets a reload re-associate the restored
    # overlay with its document.
    doc_rel_path = models.CharField(null=True)

    class Meta:
        db_table = "agent_terminal_sessions"
        indexes = [
            models.Index(
                fields=["task_id", "terminated_at", "-created_at"],
                name="idx_agent_terminal_sessions_task_created",
            ),
        ]


class AgentRunViewerLease(models.Model):
    """The control-plane owner of a currently attached terminal viewer."""

    agent_run = models.OneToOneField(
        AgentRun,
        primary_key=True,
        on_delete=models.CASCADE,
        db_column="agent_run_id",
    )
    viewer_id = models.CharField(max_length=64)
    transport = models.CharField(max_length=16)
    acquired_at = models.DateTimeField()
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "agent_run_viewer_leases"
