from django.db import models
from worktracker.models import Issue, Project

from apps.execution.execution_mode import (
    DEFAULT_EXECUTION_MODE,
    EXECUTION_MODE_CHOICES,
)


class GraphRun(models.Model):
    """Durable header for a graph run (CODIN-777).

    One row per root task. Records only the run *context* (execution mode,
    optional provider override, project,
    module) needed to rebuild the graph after an ASGI restart. Graph **edges
    are never stored** — they stay derived from ``Issue.blocked_by`` on read.
    Per-task launch facts are stored separately. A missing header means no
    subtree run is armed for the root.
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
    # Durable scheduling mode of this campaign; survives backend restarts so
    # later state or agent-lifecycle observations advance it consistently.
    execution_mode = models.CharField(
        max_length=16,
        choices=EXECUTION_MODE_CHOICES,
        default=DEFAULT_EXECUTION_MODE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "graph_runs"


class LaunchedTask(models.Model):
    """One durable fact: this task was launched by a subtree run.

    Its presence prevents *automatic* relaunch of that child. A manual press
    reads the work item's own liveness instead and retries a stalled child by
    updating its row here in place, so the one row per work item stays the final
    duplicate-launch guard; ``apps.execution.driver.reset_subtree`` clears the
    whole resource without launching replacement work.
    """

    task = models.OneToOneField(
        Issue,
        on_delete=models.CASCADE,
        primary_key=True,
        db_column="task_id",
        related_name="launched_task",
    )
    root = models.ForeignKey(
        Issue,
        on_delete=models.CASCADE,
        db_column="root_id",
        related_name="launched_subtree_tasks",
    )
    agent_run_id = models.CharField(max_length=255)
    launched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "launched_tasks"
