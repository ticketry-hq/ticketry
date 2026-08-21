import uuid

from django.db import migrations


CODEX_SPARK_MODEL = "gpt-5.3-codex-spark"


def seed_codex_5_3_spark_model(apps, schema_editor):
    Provider = apps.get_model("worktracker", "Provider")
    AgentModel = apps.get_model("worktracker", "AgentModel")
    alias = schema_editor.connection.alias

    codex = Provider.objects.using(alias).filter(slug="codex").first()
    if codex is None:
        return

    AgentModel.objects.using(alias).get_or_create(
        provider=codex,
        name=CODEX_SPARK_MODEL,
        defaults={"id": uuid.uuid4()},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0050_module_presentation"),
    ]

    operations = [
        migrations.RunPython(
            seed_codex_5_3_spark_model,
            migrations.RunPython.noop,
        ),
    ]
