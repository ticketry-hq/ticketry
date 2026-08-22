import django.db.models.deletion
from django.db import migrations, models


SCRATCH_TASK_ID = "00000000-0000-0000-0000-000000000000"


def backfill_agent_run_issues(apps, schema_editor):
    AgentRun = apps.get_model("runs", "AgentRun")
    Issue = apps.get_model("worktracker", "Issue")
    alias = schema_editor.connection.alias

    issue_ids = {
        str(issue_id)
        for issue_id in Issue.objects.using(alias).values_list("id", flat=True)
    }
    resolved_runs = []
    orphan_ids = []
    for run in AgentRun.objects.using(alias).only(
        "id", "task_id", "module_id"
    ).iterator():
        resolved_id = (
            run.task_id
            if run.task_id and run.task_id != SCRATCH_TASK_ID
            else run.module_id
        )
        if resolved_id and str(resolved_id) in issue_ids:
            run.issue_id = resolved_id
            resolved_runs.append(run)
        else:
            orphan_ids.append(run.id)

    if resolved_runs:
        AgentRun.objects.using(alias).bulk_update(
            resolved_runs, ["issue"], batch_size=500
        )
    if orphan_ids:
        for offset in range(0, len(orphan_ids), 500):
            batch = orphan_ids[offset : offset + 500]
            AgentRun.objects.using(alias).filter(
                id__in=batch
            ).delete()
    print(f"AgentRun issue backfill deleted {len(orphan_ids)} orphan row(s)")


def backfill_agent_run_scopes(apps, schema_editor):
    AgentRun = apps.get_model("runs", "AgentRun")
    alias = schema_editor.connection.alias
    AgentRun.objects.using(alias).filter(scope__isnull=True).update(scope="task")


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0007_backfill_terminal_lifecycle_state"),
        ("worktracker", "0036_issue_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="issue",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agent_runs",
                to="worktracker.issue",
            ),
        ),
        migrations.RunPython(
            backfill_agent_run_issues,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="agentrun",
            name="issue",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agent_runs",
                to="worktracker.issue",
            ),
        ),
        migrations.RunPython(
            backfill_agent_run_scopes,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="agentrun",
            name="scope",
            field=models.CharField(),
        ),
        migrations.RemoveIndex(
            model_name="agentrun",
            name="idx_agent_runs_task_started_at",
        ),
        migrations.AddIndex(
            model_name="agentrun",
            index=models.Index(
                fields=["issue", "-started_at"],
                name="idx_agent_runs_issue_started",
            ),
        ),
        migrations.RemoveField(model_name="agentrun", name="project_id"),
        migrations.RemoveField(model_name="agentrun", name="module_id"),
        migrations.RemoveField(model_name="agentrun", name="task_id"),
        migrations.RemoveField(model_name="agentrun", name="workspace_slug"),
    ]
