from django.db import models
from worktracker.models import Issue, Project


class GraphRun(models.Model):
    """Durable header for an execute-graph run (CODIN-777).

    One row per root task. Records only the run *context* (optional provider
    override, project,
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "graph_runs"


class LaunchedTask(models.Model):
    """One durable fact: this task was launched by a subtree run.

    Its presence prevents relaunch until the subtree ledger is reset — see
    ``apps.execution.driver.reset_subtree``, which deletes these rows so the
    children become launchable again.
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
