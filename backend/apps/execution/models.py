from django.db import models
from worktracker.models import Issue, Project


class EngineRun(models.Model):
    """Durable execution state; ``agent`` is the optional caller override."""

    task = models.OneToOneField(
        Issue,
        on_delete=models.CASCADE,
        primary_key=True,
        db_column="task_id",
        related_name="engine_run",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        db_column="project_id",
        related_name="engine_runs",
    )
    module = models.ForeignKey(
        Issue,
        on_delete=models.SET_NULL,
        null=True,
        db_column="module_id",
        related_name="module_engine_runs",
    )
    agent = models.CharField(max_length=255, null=True, blank=True)
    phase = models.CharField(max_length=50, default="implement")
    status = models.CharField(max_length=50, default="idle")
    agent_run_id = models.CharField(max_length=255, null=True, blank=True)
    error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "engine_runs"


class GraphRun(models.Model):
    """Durable header for an execute-graph run (CODIN-777).

    One row per root task. Records only the run *context* (optional provider
    override, project,
    module) needed to rebuild the graph after an ASGI restart. Graph **edges
    are never stored** — they stay derived from ``Issue.blocked_by`` on read.
    Per-node status is likewise not stored here; it reuses the S1 ``EngineRun``
    rows (one per descendant task, ``phase="implement"``). A missing header row
    is what a GET 404 now means: "no graph run exists," not "the server
    restarted."
    """

    root = models.OneToOneField(
        Issue,
        on_delete=models.CASCADE,
        primary_key=True,
        db_column="root_id",
        related_name="graph_run",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        db_column="project_id",
        related_name="graph_runs",
    )
    module = models.ForeignKey(
        Issue,
        on_delete=models.SET_NULL,
        null=True,
        db_column="module_id",
        related_name="module_graph_runs",
    )
    # Kept as ``agent`` for wire/storage compatibility; null delegates provider
    # selection to each node's current-state launch binding.
    agent = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "graph_runs"
