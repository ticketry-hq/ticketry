from django.db import migrations


def drop_orchestrator_tables(apps, schema_editor):
    """Irreversibly remove tables owned by the retired orchestrator product."""

    quote = schema_editor.connection.ops.quote_name
    tables = (
        "orchestrator_facts",
        "orchestrator_run_nodes",
        "orchestrator_headless_runs",
        "orchestrator_runs",
    )
    with schema_editor.connection.cursor() as cursor:
        for table in tables:
            cursor.execute(f"DROP TABLE IF EXISTS {quote(table)}")


class Migration(migrations.Migration):
    dependencies = [("runs", "0002_agentrun_resumed_from")]

    operations = [migrations.RunPython(drop_orchestrator_tables, migrations.RunPython.noop)]
