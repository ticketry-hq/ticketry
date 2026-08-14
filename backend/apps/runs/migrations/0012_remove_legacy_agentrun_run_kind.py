from django.db import migrations


def remove_legacy_run_kind(apps, schema_editor):
    """Converge databases that still carry the pre-Django run-kind column."""

    connection = schema_editor.connection
    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, "agent_runs"
            )
        }

    if "run_kind" in columns:
        quote = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote('agent_runs')} DROP COLUMN {quote('run_kind')};"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0011_dismiss_historical_automation_failures"),
    ]

    operations = [
        migrations.RunPython(
            remove_legacy_run_kind,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
