from django.db import migrations, models


def copy_terminal_context(apps, schema_editor):
    """Preserve child-only doc context and any unprojected termination."""

    AgentRun = apps.get_model("runs", "AgentRun")
    AgentTerminalSession = apps.get_model("terminals", "AgentTerminalSession")
    using = schema_editor.connection.alias

    for terminal in AgentTerminalSession.objects.using(using).all().iterator():
        updates = {
            "doc_rel_path": terminal.doc_rel_path,
            # The old table proves a transport existed, but it cannot identify
            # which runtime owner created it, so preserve that distinction.
            "terminal_owner_id": "legacy",
        }
        run = AgentRun.objects.using(using).filter(pk=terminal.agent_run_id).first()
        if run is None:
            continue
        if terminal.terminated_at and not run.ended_at:
            # Preserve active-list semantics if an old process died between
            # soft-deleting the mirror and projecting termination to AgentRun.
            updates.update(
                status="terminated",
                ended_at=terminal.terminated_at,
                lifecycle_state="exited",
                lifecycle_updated_at=terminal.terminated_at,
            )
        AgentRun.objects.using(using).filter(pk=run.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0008_agentrun_issue"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="doc_rel_path",
            field=models.CharField(null=True),
        ),
        migrations.AddField(
            model_name="agentrun",
            name="terminal_owner_id",
            field=models.CharField(null=True),
        ),
        migrations.RunPython(copy_terminal_context, migrations.RunPython.noop),
    ]
