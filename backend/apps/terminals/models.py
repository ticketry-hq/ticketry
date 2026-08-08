from django.db import models

from apps.runs.models import AgentRun


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
