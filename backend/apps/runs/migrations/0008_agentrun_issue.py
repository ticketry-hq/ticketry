import uuid

import django.db.models.deletion
from django.db import migrations, models


_SCRATCH_TASK_ID = "00000000-0000-0000-0000-000000000000"


def _uuid_or_none(value):
    if not value or value == _SCRATCH_TASK_ID:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def backfill_issue_and_scope(apps, schema_editor):
    """Link legacy routing columns to Issue, dropping unresolvable runs."""

    AgentRun = apps.get_model("runs", "AgentRun")
    AgentTerminalSession = apps.get_model("terminals", "AgentTerminalSession")
    Issue = apps.get_model("worktracker", "Issue")
    using = schema_editor.connection.alias

    terminal_scopes = dict(
        AgentTerminalSession.objects.using(using).values_list(
            "agent_run_id", "scope"
        )
    )
    for run in AgentRun.objects.using(using).all().iterator():
        candidate = _uuid_or_none(run.task_id) or _uuid_or_none(run.module_id)
        issue = (
            Issue.objects.using(using).filter(pk=candidate).first()
            if candidate is not None
            else None
        )
        if issue is None:
            # A non-null FK cannot represent this legacy row. Its one-to-one
            # terminal mirror cascades with it; unrelated application data is
            # deliberately left untouched.
            run.delete(using=using)
            continue
        scope = run.scope or terminal_scopes.get(run.pk)
        if not scope:
            scope = "task" if issue.module_id else "plan"
        AgentRun.objects.using(using).filter(pk=run.pk).update(
            issue_id=issue.pk,
            scope=scope,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0007_backfill_terminal_lifecycle_state"),
        ("terminals", "0002_agent_run_viewer_lease"),
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
        migrations.RunPython(backfill_issue_and_scope, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="agentrun",
            name="idx_agent_runs_task_started_at",
        ),
        migrations.RemoveField(model_name="agentrun", name="workspace_slug"),
        migrations.RemoveField(model_name="agentrun", name="project_id"),
        migrations.RemoveField(model_name="agentrun", name="module_id"),
        migrations.RemoveField(model_name="agentrun", name="task_id"),
        migrations.AlterField(
            model_name="agentrun",
            name="issue",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agent_runs",
                to="worktracker.issue",
            ),
        ),
        migrations.AlterField(
            model_name="agentrun",
            name="scope",
            field=models.CharField(),
        ),
    ]
